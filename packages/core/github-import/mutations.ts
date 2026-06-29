import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { githubImportKeys } from "./queries";
import { projectKeys } from "../projects/queries";
import { useWorkspaceId } from "../hooks";

export function useSaveGitHubToken() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: (token: string) => api.saveGitHubPAT(token),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: githubImportKeys.tokenStatus(wsId) });
    },
  });
}

export function useDeleteGitHubToken() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: () => api.deleteGitHubPAT(),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: githubImportKeys.tokenStatus(wsId) });
    },
  });
}

export function useImportGitHubRepo() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: (repoFullName: string) => api.importGitHubRepo(repoFullName),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: projectKeys.list(wsId) });
    },
  });
}
