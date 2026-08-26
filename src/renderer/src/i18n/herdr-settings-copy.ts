// Horca-only terminal-backend copy. Keep it out of locale JSON so Shepherd
// does not conflict every time upstream ships translations.

export const herdrSettingsCopy = {
  projectTitle: 'Terminal backend',
  projectHerdr: 'Herdr',
  projectOrca: 'Orca',
  projectPreference: 'Project preference',
  projectPreferenceDescription:
    'Changing an active project requires an explicit migration. Running Orca PTYs block migration to Herdr.',
  projectAria: 'Project terminal backend',
  projectInherit: 'Inherit',
  repositoryTitle: 'Terminal backend',
  repositoryDescription: 'Choose Orca or Herdr for this project.',
  sectionTitle: 'Terminal runtime',
  sectionDescription: 'Choose which runtime owns new project terminal sessions.',
  defaultBackend: 'Default backend',
  defaultDescription:
    'Existing projects keep their active backend until you migrate them explicitly.',
  defaultAria: 'Default terminal backend',
  sectionOrca: 'Orca',
  sectionHerdr: 'Herdr',
  installation: 'Herdr installation',
  installationDescription: 'From PATH resolves the stock Herdr executable on each execution host.',
  installationAria: 'Herdr installation source',
  system: 'From PATH',
  custom: 'Custom',
  customPath: 'Custom Herdr path',
  customPathDescription: 'Absolute executable path on the execution host.',
  customPathAria: 'Custom Herdr executable path',
  customPathPlaceholder: '/usr/local/bin/herdr',
  sessionName: 'Shared Herdr session name',
  sessionNameDescription:
    'All projects without an explicit override share this stock Herdr session. Clear it to fall back to per-project sessions.',
  sessionNameAria: 'Shared Herdr session name',
  sessionNamePlaceholder: 'orca',
  searchTitle: 'Terminal runtime',
  searchDescription: 'Choose Orca or Herdr as the terminal backend.'
} as const

export function herdrActiveBackendLabel(backend: 'herdr' | 'orca'): string {
  return `Active: ${backend === 'herdr' ? herdrSettingsCopy.projectHerdr : herdrSettingsCopy.projectOrca}`
}

export function herdrMigrationBlockedCopy(liveTerminalCount: number): string {
  return liveTerminalCount === 1
    ? `Close the ${liveTerminalCount} live Orca terminal before migrating this project to Herdr.`
    : `Close the ${liveTerminalCount} live Orca terminals before migrating this project to Herdr.`
}
