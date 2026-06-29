package handler

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/service"
	"github.com/multica-ai/multica/server/internal/util/secretbox"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

// gitHubImportBox returns the secretbox used to encrypt/decrypt GitHub PATs.
// Prefers MULTICA_GITHUB_PAT_KEY (base64 32 bytes); falls back to a key
// derived from JWT_SECRET via SHA-256 so self-hosted deployments with no
// extra configuration still get at-rest encryption.
func gitHubImportBox() (*secretbox.Box, error) {
	if key, err := secretbox.LoadKey("MULTICA_GITHUB_PAT_KEY"); err == nil {
		return secretbox.New(key)
	}
	jwtSecret := strings.TrimSpace(os.Getenv("JWT_SECRET"))
	if jwtSecret == "" {
		return nil, fmt.Errorf("github-import: neither MULTICA_GITHUB_PAT_KEY nor JWT_SECRET is set")
	}
	h := sha256.Sum256([]byte(jwtSecret))
	return secretbox.New(h[:])
}

// tokenHint returns the last 4 characters of a PAT for display purposes.
func tokenHint(token string) string {
	if len(token) <= 4 {
		return token
	}
	return token[len(token)-4:]
}

// ── PAT management ──────────────────────────────────────────────────────────

type GitHubPATStatusResponse struct {
	HasToken bool   `json:"has_token"`
	Hint     string `json:"hint,omitempty"`
}

// GetGitHubPATStatus returns whether a GitHub PAT is stored for this workspace.
func (h *Handler) GetGitHubPATStatus(w http.ResponseWriter, r *http.Request) {
	workspaceID := h.resolveWorkspaceID(r)
	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace id")
	if !ok {
		return
	}
	pat, err := h.Queries.GetGitHubPAT(r.Context(), wsUUID)
	if err != nil {
		writeJSON(w, http.StatusOK, GitHubPATStatusResponse{HasToken: false})
		return
	}
	writeJSON(w, http.StatusOK, GitHubPATStatusResponse{
		HasToken: true,
		Hint:     pat.TokenHint,
	})
}

type SaveGitHubPATRequest struct {
	Token string `json:"token"`
}

// SaveGitHubPAT encrypts and stores a GitHub PAT for the workspace.
func (h *Handler) SaveGitHubPAT(w http.ResponseWriter, r *http.Request) {
	workspaceID := h.resolveWorkspaceID(r)
	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace id")
	if !ok {
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	var req SaveGitHubPATRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	token := strings.TrimSpace(req.Token)
	if token == "" {
		writeError(w, http.StatusBadRequest, "token is required")
		return
	}

	// Validate the token by calling the GitHub API.
	ghUser, err := fetchGitHubUser(r.Context(), token)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid GitHub token: "+err.Error())
		return
	}
	_ = ghUser

	box, err := gitHubImportBox()
	if err != nil {
		slog.Error("github-import: encryption not available", "error", err)
		writeError(w, http.StatusInternalServerError, "encryption not configured")
		return
	}
	encrypted, err := box.Seal([]byte(token))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to encrypt token")
		return
	}

	userUUID, ok := parseUUIDOrBadRequest(w, userID, "user id")
	if !ok {
		return
	}

	_, err = h.Queries.UpsertGitHubPAT(r.Context(), db.UpsertGitHubPATParams{
		WorkspaceID:    wsUUID,
		EncryptedToken: encrypted,
		TokenHint:      tokenHint(token),
		CreatedBy:      userUUID,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save token")
		return
	}
	writeJSON(w, http.StatusOK, GitHubPATStatusResponse{
		HasToken: true,
		Hint:     tokenHint(token),
	})
}

// DeleteGitHubPAT removes the stored GitHub PAT for this workspace.
func (h *Handler) DeleteGitHubPAT(w http.ResponseWriter, r *http.Request) {
	workspaceID := h.resolveWorkspaceID(r)
	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace id")
	if !ok {
		return
	}
	if err := h.Queries.DeleteGitHubPAT(r.Context(), wsUUID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete token")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ── Decrypt helper ──────────────────────────────────────────────────────────

func (h *Handler) decryptGitHubPAT(ctx context.Context, wsUUID pgtype.UUID) (string, error) {
	pat, err := h.Queries.GetGitHubPAT(ctx, wsUUID)
	if err != nil {
		return "", fmt.Errorf("no GitHub token stored for this workspace")
	}
	box, err := gitHubImportBox()
	if err != nil {
		return "", fmt.Errorf("encryption not configured")
	}
	plaintext, err := box.Open(pat.EncryptedToken)
	if err != nil {
		return "", fmt.Errorf("failed to decrypt token")
	}
	return string(plaintext), nil
}

// ── GitHub API helpers ──────────────────────────────────────────────────────

type gitHubUserResponse struct {
	Login     string `json:"login"`
	AvatarURL string `json:"avatar_url"`
}

func fetchGitHubUser(ctx context.Context, token string) (*gitHubUserResponse, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.github.com/user", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("GitHub API returned %d: %s", resp.StatusCode, string(body))
	}
	var user gitHubUserResponse
	if err := json.NewDecoder(resp.Body).Decode(&user); err != nil {
		return nil, err
	}
	return &user, nil
}

type GitHubRepoResponse struct {
	ID          int64  `json:"id"`
	FullName    string `json:"full_name"`
	Name        string `json:"name"`
	Owner       string `json:"owner"`
	Description string `json:"description"`
	HTMLURL     string `json:"html_url"`
	Private     bool   `json:"private"`
	Stars       int    `json:"stargazers_count"`
	Language    string `json:"language"`
	UpdatedAt   string `json:"updated_at"`
	OpenIssues  int    `json:"open_issues_count"`
}

// ListGitHubRepos returns the authenticated user's GitHub repositories.
func (h *Handler) ListGitHubRepos(w http.ResponseWriter, r *http.Request) {
	workspaceID := h.resolveWorkspaceID(r)
	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace id")
	if !ok {
		return
	}
	token, err := h.decryptGitHubPAT(r.Context(), wsUUID)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	page := 1
	if p := r.URL.Query().Get("page"); p != "" {
		if v, err := strconv.Atoi(p); err == nil && v > 0 {
			page = v
		}
	}
	perPage := 30
	if pp := r.URL.Query().Get("per_page"); pp != "" {
		if v, err := strconv.Atoi(pp); err == nil && v > 0 && v <= 100 {
			perPage = v
		}
	}
	search := r.URL.Query().Get("q")

	var apiURL string
	if search != "" {
		apiURL = fmt.Sprintf(
			"https://api.github.com/search/repositories?q=%s+user:@me&sort=updated&per_page=%d&page=%d",
			url.QueryEscape(search), perPage, page,
		)
	} else {
		apiURL = fmt.Sprintf(
			"https://api.github.com/user/repos?sort=updated&per_page=%d&page=%d&affiliation=owner,collaborator,organization_member",
			perPage, page,
		)
	}

	ghReq, err := http.NewRequestWithContext(r.Context(), http.MethodGet, apiURL, nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to build GitHub request")
		return
	}
	ghReq.Header.Set("Authorization", "Bearer "+token)
	ghReq.Header.Set("Accept", "application/vnd.github+json")

	ghResp, err := http.DefaultClient.Do(ghReq)
	if err != nil {
		writeError(w, http.StatusBadGateway, "failed to reach GitHub API")
		return
	}
	defer ghResp.Body.Close()
	if ghResp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(ghResp.Body)
		writeError(w, http.StatusBadGateway, fmt.Sprintf("GitHub API returned %d: %s", ghResp.StatusCode, string(body)))
		return
	}

	var repos []GitHubRepoResponse
	if search != "" {
		var searchResp struct {
			Items []struct {
				ID          int64  `json:"id"`
				FullName    string `json:"full_name"`
				Name        string `json:"name"`
				Owner       struct {
					Login string `json:"login"`
				} `json:"owner"`
				Description *string `json:"description"`
				HTMLURL     string  `json:"html_url"`
				Private     bool    `json:"private"`
				Stars       int     `json:"stargazers_count"`
				Language    *string `json:"language"`
				UpdatedAt   string  `json:"updated_at"`
				OpenIssues  int     `json:"open_issues_count"`
			} `json:"items"`
		}
		if err := json.NewDecoder(ghResp.Body).Decode(&searchResp); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to parse GitHub search response")
			return
		}
		for _, item := range searchResp.Items {
			desc := ""
			if item.Description != nil {
				desc = *item.Description
			}
			lang := ""
			if item.Language != nil {
				lang = *item.Language
			}
			repos = append(repos, GitHubRepoResponse{
				ID:          item.ID,
				FullName:    item.FullName,
				Name:        item.Name,
				Owner:       item.Owner.Login,
				Description: desc,
				HTMLURL:     item.HTMLURL,
				Private:     item.Private,
				Stars:       item.Stars,
				Language:    lang,
				UpdatedAt:   item.UpdatedAt,
				OpenIssues:  item.OpenIssues,
			})
		}
	} else {
		var rawRepos []struct {
			ID    int64  `json:"id"`
			FullName string `json:"full_name"`
			Name     string `json:"name"`
			Owner    struct {
				Login string `json:"login"`
			} `json:"owner"`
			Description *string `json:"description"`
			HTMLURL     string  `json:"html_url"`
			Private     bool    `json:"private"`
			Stars       int     `json:"stargazers_count"`
			Language    *string `json:"language"`
			UpdatedAt   string  `json:"updated_at"`
			OpenIssues  int     `json:"open_issues_count"`
		}
		if err := json.NewDecoder(ghResp.Body).Decode(&rawRepos); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to parse GitHub repos response")
			return
		}
		for _, item := range rawRepos {
			desc := ""
			if item.Description != nil {
				desc = *item.Description
			}
			lang := ""
			if item.Language != nil {
				lang = *item.Language
			}
			repos = append(repos, GitHubRepoResponse{
				ID:          item.ID,
				FullName:    item.FullName,
				Name:        item.Name,
				Owner:       item.Owner.Login,
				Description: desc,
				HTMLURL:     item.HTMLURL,
				Private:     item.Private,
				Stars:       item.Stars,
				Language:    lang,
				UpdatedAt:   item.UpdatedAt,
				OpenIssues:  item.OpenIssues,
			})
		}
	}

	if repos == nil {
		repos = []GitHubRepoResponse{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"repos": repos})
}

// ── Import ──────────────────────────────────────────────────────────────────

type ImportGitHubRepoRequest struct {
	RepoFullName string `json:"repo_full_name"` // "owner/name"
}

type gitHubIssue struct {
	Number    int    `json:"number"`
	Title     string `json:"title"`
	Body      string `json:"body"`
	State     string `json:"state"`
	HTMLURL   string `json:"html_url"`
	Labels    []struct {
		Name string `json:"name"`
	} `json:"labels"`
	PullRequest *struct{} `json:"pull_request,omitempty"`
}

// mapGitHubLabelsToPriority maps common GitHub label names to Multica priority.
func mapGitHubLabelsToPriority(labels []struct {
	Name string `json:"name"`
}) string {
	for _, l := range labels {
		name := strings.ToLower(l.Name)
		switch {
		case strings.Contains(name, "critical") || strings.Contains(name, "urgent") || strings.Contains(name, "p0"):
			return "urgent"
		case strings.Contains(name, "high") || strings.Contains(name, "p1"):
			return "high"
		case strings.Contains(name, "medium") || strings.Contains(name, "p2"):
			return "medium"
		case strings.Contains(name, "low") || strings.Contains(name, "p3"):
			return "low"
		}
	}
	return "none"
}

// ImportGitHubRepo creates a project and imports the repo's open issues.
func (h *Handler) ImportGitHubRepo(w http.ResponseWriter, r *http.Request) {
	workspaceID := h.resolveWorkspaceID(r)
	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace id")
	if !ok {
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}

	var req ImportGitHubRepoRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	parts := strings.SplitN(req.RepoFullName, "/", 2)
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		writeError(w, http.StatusBadRequest, "repo_full_name must be in owner/name format")
		return
	}
	owner, repoName := parts[0], parts[1]

	token, err := h.decryptGitHubPAT(r.Context(), wsUUID)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	// Fetch repo metadata for project description.
	repoMeta, err := fetchGitHubRepoMeta(r.Context(), token, owner, repoName)
	if err != nil {
		writeError(w, http.StatusBadGateway, "failed to fetch repo from GitHub: "+err.Error())
		return
	}

	// Fetch open issues (excluding PRs), up to 500.
	ghIssues, err := fetchGitHubIssues(r.Context(), token, owner, repoName, 500)
	if err != nil {
		writeError(w, http.StatusBadGateway, "failed to fetch issues from GitHub: "+err.Error())
		return
	}

	// Create project first (non-transactional — IssueService.Create manages
	// its own transactions per issue).
	project, err := h.Queries.CreateProject(r.Context(), db.CreateProjectParams{
		WorkspaceID: wsUUID,
		Title:       repoMeta.Name,
		Description: ptrToText(repoMeta.Description),
		Status:      "in_progress",
		Priority:    "none",
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create project")
		return
	}

	// Attach the GitHub repo as a project resource.
	repoURL := fmt.Sprintf("https://github.com/%s/%s", owner, repoName)
	_, err = h.Queries.CreateProjectResource(r.Context(), db.CreateProjectResourceParams{
		ProjectID:    project.ID,
		WorkspaceID:  project.WorkspaceID,
		ResourceType: "github_repo",
		ResourceRef:  json.RawMessage(fmt.Sprintf(`{"url":%q}`, repoURL)),
		Label:        pgtype.Text{String: req.RepoFullName, Valid: true},
		Position:     0,
		CreatedBy:    h.parseUserUUIDSafe(userID),
	})
	if err != nil {
		slog.Warn("github-import: failed to attach repo resource", "error", err)
	}

	creatorUUID, ok := parseUUIDOrBadRequest(w, userID, "user id")
	if !ok {
		return
	}

	prefix := h.getIssuePrefix(r.Context(), wsUUID)

	issuesCreated := 0
	for _, ghIssue := range ghIssues {
		priority := mapGitHubLabelsToPriority(ghIssue.Labels)
		description := ghIssue.Body
		if ghIssue.HTMLURL != "" {
			description = fmt.Sprintf("Imported from [GitHub #%d](%s)\n\n%s", ghIssue.Number, ghIssue.HTMLURL, description)
		}

		_, err := h.IssueService.Create(r.Context(), service.IssueCreateParams{
			WorkspaceID: wsUUID,
			Title:       ghIssue.Title,
			Description: strToText(description),
			Status:      "todo",
			Priority:    priority,
			CreatorType: "member",
			CreatorID:   creatorUUID,
			ProjectID:   project.ID,
		}, service.IssueCreateOpts{
			ActorID: userID,
			BroadcastPayload: func(issue db.Issue, atts []db.Attachment) map[string]any {
				return map[string]any{"issue": issueToResponse(issue, prefix)}
			},
		})
		if err != nil {
			slog.Warn("github-import: failed to create issue", "gh_number", ghIssue.Number, "error", err)
			continue
		}
		issuesCreated++
	}

	resp := projectToResponse(project)
	resp.IssueCount = int64(issuesCreated)
	h.publish(protocol.EventProjectCreated, workspaceID, "member", userID, map[string]any{"project": resp})

	writeJSON(w, http.StatusCreated, map[string]any{
		"project":       resp,
		"issues_created": issuesCreated,
	})
}

// parseUserUUIDSafe returns a pgtype.UUID for the user ID or a zero UUID.
func (h *Handler) parseUserUUIDSafe(userID string) pgtype.UUID {
	u, _ := h.parseUserUUIDOrZero(userID)
	return u
}

type gitHubRepoMeta struct {
	Name           string  `json:"name"`
	FullName       string  `json:"full_name"`
	Description    *string `json:"description"`
	DefaultBranch  string  `json:"default_branch"`
	OpenIssues     int     `json:"open_issues_count"`
}

func fetchGitHubRepoMeta(ctx context.Context, token, owner, repo string) (*gitHubRepoMeta, error) {
	url := fmt.Sprintf("https://api.github.com/repos/%s/%s", owner, repo)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("GitHub API returned %d: %s", resp.StatusCode, string(body))
	}
	var meta gitHubRepoMeta
	if err := json.NewDecoder(resp.Body).Decode(&meta); err != nil {
		return nil, err
	}
	return &meta, nil
}

func fetchGitHubIssues(ctx context.Context, token, owner, repo string, limit int) ([]gitHubIssue, error) {
	var all []gitHubIssue
	page := 1
	for len(all) < limit {
		url := fmt.Sprintf("https://api.github.com/repos/%s/%s/issues?state=open&per_page=100&page=%d", owner, repo, page)
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Accept", "application/vnd.github+json")
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			return nil, err
		}
		if resp.StatusCode != http.StatusOK {
			body, _ := io.ReadAll(resp.Body)
			resp.Body.Close()
			return nil, fmt.Errorf("GitHub API returned %d: %s", resp.StatusCode, string(body))
		}
		var issues []gitHubIssue
		if err := json.NewDecoder(resp.Body).Decode(&issues); err != nil {
			resp.Body.Close()
			return nil, err
		}
		resp.Body.Close()
		if len(issues) == 0 {
			break
		}
		for _, issue := range issues {
			// Skip pull requests (GitHub's issues endpoint includes PRs).
			if issue.PullRequest != nil {
				continue
			}
			all = append(all, issue)
			if len(all) >= limit {
				break
			}
		}
		page++
	}
	return all, nil
}
