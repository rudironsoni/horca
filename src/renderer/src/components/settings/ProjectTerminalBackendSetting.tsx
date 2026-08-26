import type { ExecutionHostId } from '../../../../shared/execution-host'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { Project, ProjectUpdateArgs } from '../../../../shared/project-types'
import { resolveTerminalBackend } from '../../../../shared/terminal-backend'
import { useState } from 'react'
import {
  herdrActiveBackendLabel,
  herdrMigrationBlockedCopy,
  herdrSettingsCopy
} from '@/i18n/herdr-settings-copy'
import type { ProjectRuntimeSessionSummary } from './repository-runtime-session-summary'
import { SearchableSetting } from './SearchableSetting'
import {
  SettingsRow,
  SettingsSegmentedControl,
  SettingsSubsectionHeader
} from './SettingsFormControls'

type ProjectTerminalBackendSettingProps = {
  project: Project
  hostId: ExecutionHostId
  settings: GlobalSettings
  runtimeSessionSummary?: ProjectRuntimeSessionSummary
  updateProject: (
    projectId: string,
    updates: ProjectUpdateArgs['updates']
  ) => void | Promise<unknown>
  repoDisplayName?: string
  forceVisible?: boolean
}

export function ProjectTerminalBackendSetting({
  project,
  hostId,
  settings,
  runtimeSessionSummary,
  updateProject,
  repoDisplayName,
  forceVisible
}: ProjectTerminalBackendSettingProps): React.JSX.Element | null {
  const [migrationBlocked, setMigrationBlocked] = useState(false)
  const preference = project.terminalBackendPreference ?? 'inherit'
  const activeBackend = resolveTerminalBackend({
    globalDefault: settings.terminalBackendDefault ?? 'orca',
    preference,
    activation: project.terminalBackendByHost?.[hostId]
  })
  const updatePreference = (value: 'inherit' | 'orca' | 'herdr'): void => {
    const target = value === 'inherit' ? settings.terminalBackendDefault : value
    if (
      activeBackend === 'orca' &&
      target === 'herdr' &&
      (runtimeSessionSummary?.liveTerminalCount ?? 0) > 0
    ) {
      setMigrationBlocked(true)
      return
    }
    setMigrationBlocked(false)
    void updateProject(project.id, { terminalBackendPreference: value })
  }

  const body = (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={herdrSettingsCopy.projectTitle}
        description={herdrActiveBackendLabel(activeBackend)}
      />
      <SettingsRow
        label={herdrSettingsCopy.projectPreference}
        description={herdrSettingsCopy.projectPreferenceDescription}
        control={
          <SettingsSegmentedControl
            ariaLabel={herdrSettingsCopy.projectAria}
            value={preference}
            onChange={(value) => updatePreference(value as 'inherit' | 'orca' | 'herdr')}
            options={[
              {
                value: 'inherit',
                label: herdrSettingsCopy.projectInherit
              },
              {
                value: 'orca',
                label: herdrSettingsCopy.projectOrca
              },
              {
                value: 'herdr',
                label: herdrSettingsCopy.projectHerdr
              }
            ]}
          />
        }
      />
      {migrationBlocked ? (
        <p role="alert" className="text-xs text-destructive">
          {herdrMigrationBlockedCopy(runtimeSessionSummary?.liveTerminalCount ?? 0)}
        </p>
      ) : null}
    </section>
  )

  if (repoDisplayName === undefined) {
    return body
  }

  return (
    <SearchableSetting
      title={herdrSettingsCopy.repositoryTitle}
      description={herdrSettingsCopy.repositoryDescription}
      keywords={[repoDisplayName, 'terminal', 'backend', 'runtime', 'herdr', 'multiplexer']}
      className="space-y-3"
      forceVisible={forceVisible}
    >
      {body}
    </SearchableSetting>
  )
}
