import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { issueKeys } from "../issues/queries";
import { projectKeys } from "../projects/queries";
import { useWorkspaceId } from "../hooks";

export function useImportProjectCSV() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: ({ projectId, csvText }: { projectId: string; csvText: string }) =>
      api.importProjectCSV(projectId, csvText),
    onSettled: (_data, _err, { projectId }) => {
      qc.invalidateQueries({ queryKey: issueKeys.all(wsId) });
      qc.invalidateQueries({ queryKey: projectKeys.list(wsId) });
      qc.invalidateQueries({ queryKey: projectKeys.detail(wsId, projectId) });
    },
  });
}
