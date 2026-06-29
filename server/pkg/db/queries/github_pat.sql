-- name: GetGitHubPAT :one
SELECT * FROM github_pat
WHERE workspace_id = $1;

-- name: UpsertGitHubPAT :one
INSERT INTO github_pat (
    workspace_id, encrypted_token, token_hint, created_by
) VALUES (
    $1, $2, $3, sqlc.narg('created_by')
)
ON CONFLICT (workspace_id) DO UPDATE SET
    encrypted_token = EXCLUDED.encrypted_token,
    token_hint = EXCLUDED.token_hint,
    updated_at = now()
RETURNING *;

-- name: DeleteGitHubPAT :exec
DELETE FROM github_pat WHERE workspace_id = $1;
