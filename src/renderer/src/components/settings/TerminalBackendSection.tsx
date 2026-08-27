import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { herdrSettingsCopy } from '@/i18n/herdr-settings-copy'
import { Input } from '../ui/input'
import {
  SettingsRow,
  SettingsSegmentedControl,
  SettingsSubsectionHeader
} from './SettingsFormControls'

type TerminalBackendSectionProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

export function TerminalBackendSection({
  settings,
  updateSettings
}: TerminalBackendSectionProps): React.JSX.Element {
  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={herdrSettingsCopy.sectionTitle}
        description={herdrSettingsCopy.sectionDescription}
      />
      <div className="divide-y divide-border/40">
        <SettingsRow
          label={herdrSettingsCopy.defaultBackend}
          description={herdrSettingsCopy.defaultDescription}
          control={
            <SettingsSegmentedControl
              ariaLabel={herdrSettingsCopy.defaultAria}
              value={settings.terminalBackendDefault ?? 'orca'}
              onChange={(value) =>
                updateSettings({ terminalBackendDefault: value as 'orca' | 'herdr' })
              }
              options={[
                {
                  value: 'orca',
                  label: herdrSettingsCopy.sectionOrca
                },
                {
                  value: 'herdr',
                  label: herdrSettingsCopy.sectionHerdr
                }
              ]}
            />
          }
        />
        <SettingsRow
          label={herdrSettingsCopy.installation}
          description={herdrSettingsCopy.installationDescription}
          control={
            <SettingsSegmentedControl
              ariaLabel={herdrSettingsCopy.installationAria}
              value={settings.herdrBinarySource?.kind ?? 'system'}
              onChange={(value) => {
                if (value === 'custom') {
                  updateSettings({ herdrBinarySource: { kind: 'custom', path: '' } })
                  return
                }
                updateSettings({ herdrBinarySource: { kind: 'system' } })
              }}
              options={[
                {
                  value: 'system',
                  label: herdrSettingsCopy.system
                },
                {
                  value: 'custom',
                  label: herdrSettingsCopy.custom
                }
              ]}
            />
          }
        />
        {settings.herdrBinarySource?.kind === 'custom' ? (
          <SettingsRow
            label={herdrSettingsCopy.customPath}
            description={herdrSettingsCopy.customPathDescription}
            control={
              <Input
                aria-label={herdrSettingsCopy.customPathAria}
                value={settings.herdrBinarySource.path}
                placeholder={herdrSettingsCopy.customPathPlaceholder}
                className="w-72"
                onChange={(event) =>
                  updateSettings({
                    herdrBinarySource: { kind: 'custom', path: event.target.value }
                  })
                }
                onBlur={(event) => {
                  if (!event.target.value.trim()) {
                    updateSettings({ herdrBinarySource: { kind: 'system' } })
                  }
                }}
              />
            }
          />
        ) : null}
        <SettingsRow
          label={herdrSettingsCopy.sessionName}
          description={herdrSettingsCopy.sessionNameDescription}
          control={
            <Input
              aria-label={herdrSettingsCopy.sessionNameAria}
              value={settings.herdrSessionName ?? ''}
              placeholder={herdrSettingsCopy.sessionNamePlaceholder}
              maxLength={64}
              className="w-72"
              onChange={(event) => updateSettings({ herdrSessionName: event.target.value })}
              onBlur={(event) => updateSettings({ herdrSessionName: event.target.value.trim() })}
            />
          }
        />
      </div>
    </section>
  )
}
