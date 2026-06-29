"use client";

import { useCallback, useMemo, useState } from "react";
import { Plus, FolderKanban, Rows3, LayoutGrid, Search } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { projectListOptions } from "@multica/core/projects/queries";
import { useUpdateProject } from "@multica/core/projects/mutations";
import { useWorkspaceId } from "@multica/core/hooks";
import { useWorkspacePaths } from "@multica/core/paths";
import { useModalStore } from "@multica/core/modals";
import { AppLink } from "../../navigation";
import { ActorAvatar } from "../../common/actor-avatar";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import { cn } from "@multica/ui/lib/utils";
import type { Project, UpdateProjectRequest } from "@multica/core/types";
import { PageHeader } from "../../layout/page-header";
import { ProjectIcon } from "./project-icon";
import { useT } from "../../i18n";
import { matchesPinyin } from "../../editor/extensions/pinyin-match";
import { useFormatRelativeDate } from "./labels";
import { useProjectViewStore } from "@multica/core/projects";
import { ProjectStatusBadge, ProjectPriorityBadge } from "./project-badge";
import { ProjectLeadPicker } from "./project-lead-picker";

function GithubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M12 .5C5.73.5.66 5.57.66 11.84c0 5.01 3.25 9.26 7.76 10.76.57.1.78-.25.78-.55 0-.27-.01-1.17-.02-2.13-3.16.69-3.83-1.34-3.83-1.34-.52-1.31-1.27-1.66-1.27-1.66-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.68 1.24 3.34.95.1-.74.4-1.24.72-1.53-2.52-.29-5.18-1.26-5.18-5.62 0-1.24.45-2.26 1.18-3.06-.12-.29-.51-1.45.11-3.02 0 0 .96-.31 3.15 1.17a10.93 10.93 0 0 1 5.74 0c2.19-1.48 3.15-1.17 3.15-1.17.62 1.57.23 2.73.11 3.02.74.8 1.18 1.82 1.18 3.06 0 4.37-2.67 5.32-5.21 5.61.41.35.78 1.04.78 2.1 0 1.52-.01 2.74-.01 3.11 0 .3.21.66.79.55 4.51-1.5 7.76-5.75 7.76-10.76C23.34 5.57 18.27.5 12 .5Z" />
    </svg>
  );
}

const COMPACT_GRID = "grid w-full min-w-[740px] grid-cols-[24px_minmax(200px,1fr)_96px_96px_80px_80px_80px]";

function ProjectCard({ project }: { project: Project }) {
  const { t } = useT("projects");
  const wsPaths = useWorkspacePaths();
  const formatRelativeDate = useFormatRelativeDate();
  const updateProject = useUpdateProject();

  const handleUpdate = useCallback(
    (data: UpdateProjectRequest) => {
      updateProject.mutate({ id: project.id, ...data });
    },
    [project.id, updateProject],
  );

  const progressPercent = project.issue_count > 0 ? Math.round((project.done_count / project.issue_count) * 100) : 0;

  return (
    <div className="group/card flex flex-col rounded-md border bg-card hover:border-primary/50 transition-colors">
      <div className="p-3 pb-2">
        <div className="flex items-center gap-2">
          <AppLink
            href={wsPaths.projectDetail(project.id)}
            className="flex items-center gap-2 min-w-0 flex-1"
          >
            <ProjectIcon project={project} size="sm" />
            <h3 className="font-medium text-sm truncate">{project.title}</h3>
          </AppLink>
          <ProjectStatusBadge project={project} handleUpdate={handleUpdate} triggerClassName="shrink-0" />
        </div>

        {project.issue_count > 0 ? (
          <div className="flex justify-end items-center gap-1.5 pt-2">
            <div className="relative h-4 w-4">
              <svg className="h-4 w-4 -rotate-90" viewBox="0 0 16 16">
                <circle
                  className="text-muted"
                  strokeWidth="2"
                  stroke="currentColor"
                  fill="none"
                  r="6"
                  cx="8"
                  cy="8"
                />
                <circle
                  className="text-emerald-500"
                  strokeWidth="2"
                  stroke="currentColor"
                  fill="none"
                  r="6"
                  cx="8"
                  cy="8"
                  strokeDasharray={`${progressPercent * 0.377} 37.7`}
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <span className="text-[10px] text-muted-foreground tabular-nums">
              {project.done_count}/{project.issue_count}
            </span>
          </div>
        ) : (
          <span className="text-[10px] text-muted-foreground pt-2 flex justify-end">{t(($) => $.detail.no_issues_yet)}</span>
        )}
      </div>

      <div className="flex items-center justify-between px-3 pb-3 border-t mt-0 pt-2">
        <ProjectLeadPicker
          project={project}
          handleUpdate={handleUpdate}
          renderTrigger={(leadName) => (
            <button type="button" className="flex items-center gap-1.5 rounded px-1.5 py-0.5 -mx-1.5 hover:bg-accent/60 transition-colors cursor-pointer">
              {project.lead_type && project.lead_id ? (
                <ActorAvatar actorType={project.lead_type} actorId={project.lead_id} size={20} enableHoverCard />
              ) : (
                <span className="inline-flex h-5 w-5 rounded-full border border-dashed border-muted-foreground/30" />
              )}
              <span className="text-[10px] text-muted-foreground truncate max-w-[60px]">
                {leadName ?? t(($) => $.lead.no_lead)}
              </span>
            </button>
          )}
        />

        <div className="flex items-center gap-2">
          <ProjectPriorityBadge project={project} handleUpdate={handleUpdate} align="start" />
          <span className="text-[10px] text-muted-foreground">
            {formatRelativeDate(project.created_at)}
          </span>
        </div>
      </div>
    </div>
  );
}

function ProjectCardCompact({ project }: { project: Project }) {
  const wsPaths = useWorkspacePaths();
  const formatRelativeDate = useFormatRelativeDate();
  const updateProject = useUpdateProject();

  const handleUpdate = useCallback(
    (data: UpdateProjectRequest) => {
      updateProject.mutate({ id: project.id, ...data });
    },
    [project.id, updateProject],
  );

  return (
    <div className={cn(COMPACT_GRID, "h-10 items-center gap-2 px-4 text-sm transition-colors hover:bg-accent/40 border-b")}>
      <ProjectIcon project={project} size="sm" />
      <AppLink
        href={wsPaths.projectDetail(project.id)}
        className="flex items-center justify-start gap-2 min-w-0 overflow-hidden"
      >
        <span className="font-medium truncate text-left">{project.title}</span>
      </AppLink>

      <div className="flex items-center justify-start">
        <ProjectPriorityBadge project={project} handleUpdate={handleUpdate} align="start" />
      </div>

      <div className="flex items-center justify-start">
        <ProjectStatusBadge project={project} handleUpdate={handleUpdate} align="start" />
      </div>

      <span className="flex items-center justify-start gap-1.5 text-xs text-muted-foreground tabular-nums">
        {project.issue_count > 0 ? `${project.done_count}/${project.issue_count}` : "--"}
      </span>

      <ProjectLeadPicker
        project={project}
        handleUpdate={handleUpdate}
        align="start"
        renderTrigger={(leadName) => (
          <button type="button" className="flex items-center justify-start gap-1.5 rounded px-1 py-0.5 hover:bg-accent/60 transition-colors cursor-pointer">
            <span className="shrink-0">
              {project.lead_type && project.lead_id ? (
                <ActorAvatar actorType={project.lead_type} actorId={project.lead_id} size={20} enableHoverCard />
              ) : (
                <span className="inline-flex h-5 w-5 rounded-full border border-dashed border-muted-foreground/30" />
              )}
            </span>
            <span className="text-xs text-muted-foreground truncate max-w-[50px]">
              {leadName ?? "--"}
            </span>
          </button>
        )}
      />

      <span className="text-left text-xs text-muted-foreground tabular-nums">
        {formatRelativeDate(project.created_at)}
      </span>
    </div>
  );
}

export function ProjectsPage() {
  const { t } = useT("projects");
  const wsId = useWorkspaceId();
  const viewMode = useProjectViewStore((s) => s.viewMode);
  const setViewMode = useProjectViewStore((s) => s.setViewMode);
  const isCompact = viewMode === "compact";
  const { data: projects = [], isLoading } = useQuery(projectListOptions(wsId));
  const openCreateProject = () => useModalStore.getState().open("create-project");
  const openGitHubImport = () => useModalStore.getState().open("github-import");

  const [search, setSearch] = useState("");
  const filteredProjects = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) =>
      p.title.toLowerCase().includes(q) || matchesPinyin(p.title, q)
    );
  }, [projects, search]);

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <PageHeader className="justify-between px-5">
        <div className="flex items-center gap-2">
          <FolderKanban className="h-4 w-4 text-muted-foreground" />
          <h1 className="text-sm font-medium">{t(($) => $.page.title)}</h1>
          {!isLoading && projects.length > 0 && (
            <span className="text-xs text-muted-foreground tabular-nums">{projects.length}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={openGitHubImport}>
            <GithubIcon className="h-3.5 w-3.5 mr-1" />
            {t(($) => $.github_import.button)}
          </Button>
          <Button size="sm" variant="outline" onClick={openCreateProject}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            {t(($) => $.page.new_project)}
          </Button>
        </div>
      </PageHeader>

      <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
        {(projects.length > 0 || isLoading) && (
          <div className="flex h-12 shrink-0 items-center justify-between border-b px-4 gap-2 sm:gap-3">
            <div className="relative flex-1 sm:flex-none">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t(($) => $.page.search_placeholder)}
                className="h-8 w-full sm:w-64 pl-8 text-sm"
              />
            </div>

            <div className="flex items-center gap-2 sm:gap-4 shrink-0">
              <span className="hidden sm:inline-block font-mono text-xs tabular-nums text-muted-foreground/70">
                {filteredProjects.length} / {projects.length}
              </span>
              <div className="flex items-center gap-0.5 rounded-md bg-muted p-0.5">
                <button
                  type="button"
                  onClick={() => setViewMode("compact")}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded p-1 sm:px-2.5 sm:py-1 text-xs font-medium transition-colors",
                    isCompact ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Rows3 className="size-3.5" />
                  <span className="hidden sm:inline-block">{t(($) => $.page.view_compact)}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("comfortable")}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded p-1 sm:px-2.5 sm:py-1 text-xs font-medium transition-colors",
                    !isCompact ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <LayoutGrid className="size-3.5" />
                  <span className="hidden sm:inline-block">{t(($) => $.page.view_comfortable)}</span>
                </button>
              </div>
            </div>
          </div>
        )}

        <div key={viewMode} className={cn("flex-1", isCompact ? "overflow-hidden flex flex-col" : "overflow-y-auto")}>
          {isLoading ? (
            isCompact ? (
              <div className="pt-4 mx-5 overflow-x-auto rounded-md border pb-4 mb-5">
                <div className="min-w-[740px]">
                  <div className={cn(COMPACT_GRID, "h-10 items-center gap-2 px-4 border-b")}>
                    <Skeleton className="h-6 w-6 rounded" />
                    <Skeleton className="h-4 w-48" />
                  </div>
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className={cn(COMPACT_GRID, "h-10 items-center gap-2 px-4 border-b")}>
                      <Skeleton className="h-6 w-6 rounded" />
                      <Skeleton className="h-4 w-48" />
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="pt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 px-5">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="flex flex-col rounded-md border p-3 gap-2">
                    <div className="flex items-center gap-2">
                      <Skeleton className="h-8 w-8 rounded" />
                      <Skeleton className="h-4 w-3/4" />
                    </div>
                    <div className="flex gap-1.5">
                      <Skeleton className="h-5 w-16 rounded" />
                      <Skeleton className="h-5 w-20 rounded" />
                    </div>
                    <div className="flex items-center justify-between">
                      <Skeleton className="h-5 w-5 rounded-full" />
                      <Skeleton className="h-3 w-12" />
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : projects.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
              <FolderKanban className="h-10 w-10 mb-3 opacity-30" />
              <p className="text-sm">{t(($) => $.page.empty)}</p>
              <Button size="sm" variant="outline" className="mt-3" onClick={openCreateProject}>
                {t(($) => $.page.create_first)}
              </Button>
            </div>
          ) : filteredProjects.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
              <Search className="h-10 w-10 mb-3 opacity-30" />
              <p className="text-sm">{t(($) => $.page.no_search_results)}</p>
            </div>
          ) : isCompact ? (
            <div className="mt-4 mx-5 rounded-md border mb-5 overflow-auto flex-1">
              <div className="min-w-[740px]">
                <div className={cn(COMPACT_GRID, "h-8 shrink-0 items-center gap-2 px-4 text-xs font-medium text-muted-foreground border-b bg-muted/30 backdrop-blur sticky top-0 z-10")}>
                  <span />
                  <span className="text-left">{t(($) => $.table.name)}</span>
                  <span className="text-left">{t(($) => $.table.priority)}</span>
                  <span className="text-left">{t(($) => $.table.status)}</span>
                  <span className="text-left">{t(($) => $.table.progress)}</span>
                  <span className="text-left">{t(($) => $.table.lead)}</span>
                  <span className="text-left">{t(($) => $.table.created)}</span>
                </div>
                <div className="pb-4">
                  {filteredProjects.map((project) => (
                    <ProjectCardCompact key={project.id} project={project} />
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="pt-4 pb-5 px-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {filteredProjects.map((project) => (
                <ProjectCard key={project.id} project={project} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
