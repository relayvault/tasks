import { queryOptions } from "@tanstack/react-query";
import { api } from "../api";

export const githubImportKeys = {
  all: (wsId: string) => ["github-import", wsId] as const,
  tokenStatus: (wsId: string) => [...githubImportKeys.all(wsId), "token"] as const,
  repos: (wsId: string, page: number, q: string) =>
    [...githubImportKeys.all(wsId), "repos", page, q] as const,
};

export const githubImportTokenOptions = (wsId: string) =>
  queryOptions({
    queryKey: githubImportKeys.tokenStatus(wsId),
    queryFn: () => api.getGitHubPATStatus(),
    enabled: !!wsId,
  });

export const githubImportReposOptions = (
  wsId: string,
  page: number,
  q: string,
  enabled: boolean,
) =>
  queryOptions({
    queryKey: githubImportKeys.repos(wsId, page, q),
    queryFn: () => api.listGitHubImportRepos({ page, per_page: 30, q: q || undefined }),
    enabled: enabled && !!wsId,
  });
