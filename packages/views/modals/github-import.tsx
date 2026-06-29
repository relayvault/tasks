"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Lock, Search, Loader2, ExternalLink, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@multica/ui/components/ui/dialog";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import { useWorkspaceId } from "@multica/core/hooks";
import {
  githubImportTokenOptions,
  githubImportReposOptions,
  useSaveGitHubToken,
  useDeleteGitHubToken,
  useImportGitHubRepo,
} from "@multica/core/github-import";
import { useWorkspacePaths } from "@multica/core/paths";
import { toast } from "sonner";
import { useNavigation } from "../navigation";
import { useT } from "../i18n";

function GithubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M12 .5C5.73.5.66 5.57.66 11.84c0 5.01 3.25 9.26 7.76 10.76.57.1.78-.25.78-.55 0-.27-.01-1.17-.02-2.13-3.16.69-3.83-1.34-3.83-1.34-.52-1.31-1.27-1.66-1.27-1.66-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.68 1.24 3.34.95.1-.74.4-1.24.72-1.53-2.52-.29-5.18-1.26-5.18-5.62 0-1.24.45-2.26 1.18-3.06-.12-.29-.51-1.45.11-3.02 0 0 .96-.31 3.15 1.17a10.93 10.93 0 0 1 5.74 0c2.19-1.48 3.15-1.17 3.15-1.17.62 1.57.23 2.73.11 3.02.74.8 1.18 1.82 1.18 3.06 0 4.37-2.67 5.32-5.21 5.61.41.35.78 1.04.78 2.1 0 1.52-.01 2.74-.01 3.11 0 .3.21.66.79.55 4.51-1.5 7.76-5.75 7.76-10.76C23.34 5.57 18.27.5 12 .5Z" />
    </svg>
  );
}

interface GitHubImportModalProps {
  onClose: () => void;
}

export function GitHubImportModal({ onClose }: GitHubImportModalProps) {
  const wsId = useWorkspaceId();
  const router = useNavigation();
  const wsPaths = useWorkspacePaths();
  const { t } = useT("projects");

  const [tokenInput, setTokenInput] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page] = useState(1);
  const [importingRepo, setImportingRepo] = useState<string | null>(null);

  const tokenQuery = useQuery(githubImportTokenOptions(wsId));
  const hasToken = tokenQuery.data?.has_token === true;

  const reposQuery = useQuery(githubImportReposOptions(wsId, page, debouncedSearch, hasToken));

  const saveToken = useSaveGitHubToken();
  const deleteToken = useDeleteGitHubToken();
  const importRepo = useImportGitHubRepo();

  // Debounce search input
  const debounceTimer = useMemo(() => {
    let timer: ReturnType<typeof setTimeout>;
    return (value: string) => {
      clearTimeout(timer);
      timer = setTimeout(() => setDebouncedSearch(value), 300);
    };
  }, []);

  const handleSearchChange = (value: string) => {
    setSearch(value);
    debounceTimer(value);
  };

  const handleSaveToken = () => {
    if (!tokenInput.trim()) return;
    saveToken.mutate(tokenInput.trim(), {
      onSuccess: () => {
        setTokenInput("");
      },
      onError: (err) => {
        toast.error(
          err instanceof Error ? err.message : t(($) => $.github_import.import_failed),
        );
      },
    });
  };

  const handleDisconnect = () => {
    deleteToken.mutate(undefined, {
      onSuccess: () => {
        setSearch("");
        setDebouncedSearch("");
      },
    });
  };

  const handleImport = (repoFullName: string) => {
    setImportingRepo(repoFullName);
    importRepo.mutate(repoFullName, {
      onSuccess: (data) => {
        toast.success(
          t(($) => $.github_import.import_success)
            .replace("{{count}}", String(data.issues_created))
            .replace("{{project}}", data.project.title),
        );
        onClose();
        router.push(wsPaths.projectDetail(data.project.id));
      },
      onError: (err) => {
        toast.error(
          err instanceof Error ? err.message : t(($) => $.github_import.import_failed),
        );
        setImportingRepo(null);
      },
    });
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent
        showCloseButton={false}
        className="p-0 gap-0 flex flex-col overflow-hidden !max-w-lg !w-full"
      >
        <DialogTitle className="sr-only">{t(($) => $.github_import.modal_title)}</DialogTitle>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="flex items-center gap-2">
            <GithubIcon className="size-4" />
            <span className="text-sm font-medium">{t(($) => $.github_import.modal_title)}</span>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Token step */}
        {!hasToken && (
          <div className="p-4 space-y-3">
            <div>
              <p className="text-sm font-medium">{t(($) => $.github_import.token_step_title)}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {t(($) => $.github_import.token_step_description)}
              </p>
            </div>
            <div className="flex gap-2">
              <Input
                type="password"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                placeholder={t(($) => $.github_import.token_placeholder)}
                className="flex-1 text-sm"
                onKeyDown={(e) => { if (e.key === "Enter") handleSaveToken(); }}
              />
              <Button
                size="sm"
                onClick={handleSaveToken}
                disabled={!tokenInput.trim() || saveToken.isPending}
              >
                {saveToken.isPending ? (
                  <><Loader2 className="size-3 animate-spin mr-1" />{t(($) => $.github_import.token_saving)}</>
                ) : (
                  t(($) => $.github_import.token_save)
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Connected state + repo list */}
        {hasToken && (
          <>
            {/* Token status bar */}
            <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
              <div className="flex items-center gap-2">
                <div className="size-2 rounded-full bg-green-500" />
                <span className="text-xs text-muted-foreground">
                  {t(($) => $.github_import.token_connected)}
                  {tokenQuery.data?.hint && (
                    <> &middot; {t(($) => $.github_import.token_hint).replace("{{hint}}", tokenQuery.data.hint)}</>
                  )}
                </span>
              </div>
              <button
                onClick={handleDisconnect}
                className="text-xs text-muted-foreground hover:text-destructive transition-colors"
                disabled={deleteToken.isPending}
              >
                {t(($) => $.github_import.token_disconnect)}
              </button>
            </div>

            {/* Search */}
            <div className="px-4 py-2 border-b">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  placeholder={t(($) => $.github_import.repos_search_placeholder)}
                  className="pl-8 text-sm h-8"
                />
              </div>
            </div>

            {/* Repo list */}
            <div className="flex-1 overflow-y-auto max-h-[400px]">
              {reposQuery.isLoading && (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                </div>
              )}

              {reposQuery.data && reposQuery.data.repos.length === 0 && (
                <div className="text-center py-8 text-sm text-muted-foreground">
                  {t(($) => $.github_import.repos_empty)}
                </div>
              )}

              {reposQuery.data?.repos.map((repo) => (
                <div
                  key={repo.id}
                  className="flex items-center justify-between px-4 py-2.5 hover:bg-muted/50 border-b last:border-b-0 transition-colors"
                >
                  <div className="flex-1 min-w-0 mr-3">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium truncate">{repo.full_name}</span>
                      {repo.private && (
                        <Lock className="size-3 text-muted-foreground shrink-0" />
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      {repo.language && (
                        <span className="text-xs text-muted-foreground">{repo.language}</span>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {t(($) => $.github_import.repos_issues).replace("{{count}}", String(repo.open_issues_count))}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <a
                      href={repo.html_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted-foreground hover:text-foreground p-1"
                    >
                      <ExternalLink className="size-3.5" />
                    </a>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleImport(repo.full_name)}
                      disabled={importingRepo !== null}
                    >
                      {importingRepo === repo.full_name ? (
                        <><Loader2 className="size-3 animate-spin mr-1" />{t(($) => $.github_import.importing)}</>
                      ) : (
                        t(($) => $.github_import.import_button)
                      )}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
