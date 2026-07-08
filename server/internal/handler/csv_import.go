package handler

import (
	"encoding/csv"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/service"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// csvImportMaxRows caps the number of data rows accepted in one import.
const csvImportMaxRows = 1000

// csvImportMaxBytes caps the raw upload size (2 MB).
const csvImportMaxBytes = 2 << 20

// csvLabelColors is the palette cycled through when auto-creating labels.
var csvLabelColors = []string{
	"#ef4444", "#f97316", "#eab308", "#22c55e",
	"#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899",
}

// csvImportRow is one parsed data row from the uploaded CSV.
type csvImportRow struct {
	line     int
	rowType  string // "epic" or "task"
	title    string
	desc     string
	status   string
	epic     string // parent epic title (tasks only)
	labels   []string
	assignee string
	dueDate  pgtype.Date
}

// mapCSVStatus normalizes a CSV status cell to a Multica issue status.
func mapCSVStatus(s string) string {
	switch strings.ReplaceAll(strings.ToLower(strings.TrimSpace(s)), " ", "_") {
	case "backlog":
		return "backlog"
	case "in_progress", "doing", "wip":
		return "in_progress"
	case "in_review", "review":
		return "in_review"
	case "done", "complete", "completed", "closed":
		return "done"
	case "blocked":
		return "blocked"
	case "cancelled", "canceled":
		return "cancelled"
	default:
		return "todo"
	}
}

// parseCSVImportRows reads and validates the uploaded CSV. The required
// header columns are Title and Status; the remaining columns from the
// documented format (Type, Description, Epic, Project, Labels, Assignee,
// Due Date) are optional and matched case-insensitively by name.
func parseCSVImportRows(r io.Reader) ([]csvImportRow, error) {
	reader := csv.NewReader(r)
	reader.FieldsPerRecord = -1

	header, err := reader.Read()
	if err != nil {
		return nil, fmt.Errorf("failed to read CSV header: %w", err)
	}
	col := map[string]int{}
	for i, name := range header {
		key := strings.ReplaceAll(strings.ToLower(strings.TrimSpace(strings.TrimPrefix(name, "\ufeff"))), " ", "_")
		col[key] = i
	}
	if _, ok := col["title"]; !ok {
		return nil, fmt.Errorf("CSV is missing required column: Title")
	}

	cell := func(record []string, name string) string {
		i, ok := col[name]
		if !ok || i >= len(record) {
			return ""
		}
		return strings.TrimSpace(record[i])
	}

	var rows []csvImportRow
	line := 1
	for {
		record, err := reader.Read()
		if err == io.EOF {
			break
		}
		line++
		if err != nil {
			return nil, fmt.Errorf("line %d: %w", line, err)
		}
		if len(rows) >= csvImportMaxRows {
			return nil, fmt.Errorf("CSV exceeds the maximum of %d rows", csvImportMaxRows)
		}

		title := cell(record, "title")
		if title == "" {
			continue
		}
		rowType := strings.ToLower(cell(record, "type"))
		if rowType != "epic" {
			rowType = "task"
		}

		var labels []string
		for _, l := range strings.Split(cell(record, "labels"), ";") {
			if l = strings.TrimSpace(l); l != "" {
				labels = append(labels, l)
			}
		}

		var due pgtype.Date
		if d := cell(record, "due_date"); d != "" {
			if t, err := time.Parse("2006-01-02", d); err == nil {
				due = pgtype.Date{Time: t, Valid: true}
			}
		}

		rows = append(rows, csvImportRow{
			line:     line,
			rowType:  rowType,
			title:    title,
			desc:     cell(record, "description"),
			status:   mapCSVStatus(cell(record, "status")),
			epic:     cell(record, "epic"),
			labels:   labels,
			assignee: cell(record, "assignee"),
			dueDate:  due,
		})
	}
	if len(rows) == 0 {
		return nil, fmt.Errorf("CSV contains no importable rows")
	}
	return rows, nil
}

// ImportProjectCSV bulk-creates issues in an existing project from an
// uploaded CSV (Content-Type: text/csv). Epic rows become parent issues;
// task rows referencing an Epic title become their children. Labels are
// created on demand and attached; assignees are matched against workspace
// members by name or email prefix.
func (h *Handler) ImportProjectCSV(w http.ResponseWriter, r *http.Request) {
	workspaceID := h.resolveWorkspaceID(r)
	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace id")
	if !ok {
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	creatorUUID, ok := parseUUIDOrBadRequest(w, userID, "user id")
	if !ok {
		return
	}
	projectUUID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "projectId"), "project id")
	if !ok {
		return
	}
	project, err := h.Queries.GetProject(r.Context(), projectUUID)
	if err != nil || project.WorkspaceID != wsUUID {
		writeError(w, http.StatusNotFound, "project not found")
		return
	}

	rows, err := parseCSVImportRows(io.LimitReader(r.Body, csvImportMaxBytes))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	// Assignee lookup: workspace member name or email (or email local part),
	// case-insensitive.
	memberByKey := map[string]pgtype.UUID{}
	if members, err := h.Queries.ListMembersWithUser(r.Context(), wsUUID); err == nil {
		for _, m := range members {
			memberByKey[strings.ToLower(m.UserName)] = m.UserID
			email := strings.ToLower(m.UserEmail)
			memberByKey[email] = m.UserID
			if at := strings.Index(email, "@"); at > 0 {
				memberByKey[email[:at]] = m.UserID
			}
		}
	}

	// Label lookup: existing labels by lowercase name; missing ones are
	// created lazily as rows reference them.
	labelByName := map[string]pgtype.UUID{}
	if labels, err := h.Queries.ListLabels(r.Context(), wsUUID); err == nil {
		for _, l := range labels {
			labelByName[strings.ToLower(l.Name)] = l.ID
		}
	}
	resolveLabel := func(name string) (pgtype.UUID, bool) {
		key := strings.ToLower(name)
		if id, ok := labelByName[key]; ok {
			return id, true
		}
		label, err := h.Queries.CreateLabel(r.Context(), db.CreateLabelParams{
			WorkspaceID: wsUUID,
			Name:        name,
			Color:       csvLabelColors[len(labelByName)%len(csvLabelColors)],
		})
		if err != nil {
			slog.Warn("csv-import: failed to create label", "label", name, "error", err)
			return pgtype.UUID{}, false
		}
		labelByName[key] = label.ID
		return label.ID, true
	}

	prefix := h.getIssuePrefix(r.Context(), wsUUID)

	createIssue := func(row csvImportRow, parentID pgtype.UUID) (db.Issue, error) {
		params := service.IssueCreateParams{
			WorkspaceID:    wsUUID,
			Title:          row.title,
			Description:    strToText(row.desc),
			Status:         row.status,
			Priority:       "none",
			CreatorType:    "member",
			CreatorID:      creatorUUID,
			ParentIssueID:  parentID,
			ProjectID:      project.ID,
			DueDate:        row.dueDate,
			AllowDuplicate: true,
		}
		if id, ok := memberByKey[strings.ToLower(row.assignee)]; ok && row.assignee != "" {
			params.AssigneeType = strToText("member")
			params.AssigneeID = id
		}
		result, err := h.IssueService.Create(r.Context(), params, service.IssueCreateOpts{
			ActorID: userID,
			BroadcastPayload: func(issue db.Issue, atts []db.Attachment) map[string]any {
				return map[string]any{"issue": issueToResponse(issue, prefix)}
			},
		})
		if err != nil {
			return db.Issue{}, err
		}
		issue := result.Issue
		for _, name := range row.labels {
			labelID, ok := resolveLabel(name)
			if !ok {
				continue
			}
			if err := h.Queries.AttachLabelToIssue(r.Context(), db.AttachLabelToIssueParams{
				IssueID:     issue.ID,
				LabelID:     labelID,
				WorkspaceID: wsUUID,
			}); err != nil {
				slog.Warn("csv-import: failed to attach label", "label", name, "error", err)
			}
		}
		return issue, nil
	}

	// Pass 1: epics, recording title → issue ID so tasks can parent to them.
	epicIDByTitle := map[string]pgtype.UUID{}
	created := 0
	var rowErrors []string
	for _, row := range rows {
		if row.rowType != "epic" {
			continue
		}
		issue, err := createIssue(row, pgtype.UUID{})
		if err != nil {
			slog.Warn("csv-import: failed to create epic", "line", row.line, "error", err)
			rowErrors = append(rowErrors, fmt.Sprintf("line %d (%s): %s", row.line, row.title, err.Error()))
			continue
		}
		epicIDByTitle[strings.ToLower(row.title)] = issue.ID
		created++
	}

	// Pass 2: tasks.
	for _, row := range rows {
		if row.rowType == "epic" {
			continue
		}
		parentID := epicIDByTitle[strings.ToLower(row.epic)]
		if _, err := createIssue(row, parentID); err != nil {
			slog.Warn("csv-import: failed to create issue", "line", row.line, "error", err)
			rowErrors = append(rowErrors, fmt.Sprintf("line %d (%s): %s", row.line, row.title, err.Error()))
			continue
		}
		created++
	}

	writeJSON(w, http.StatusCreated, map[string]any{
		"issues_created": created,
		"rows_total":     len(rows),
		"errors":         rowErrors,
	})
}
