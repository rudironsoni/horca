import { readFileSync, writeFileSync } from 'node:fs'

export const HORCA_MOBILE_ANDROID_PACKAGE = 'com.rudironsoni.horca.mobile'

function androidPackageNames(config) {
  const clients = Array.isArray(config?.client) ? config.client : []
  const names = []
  for (const client of clients) {
    const packageName = client?.client_info?.android_client_info?.package_name
    if (typeof packageName === 'string') {
      names.push(packageName)
    }
  }
  return names
}

export function retargetGoogleServicesPackage(
  filePath,
  packageName = HORCA_MOBILE_ANDROID_PACKAGE
) {
  const config = JSON.parse(readFileSync(filePath, 'utf8'))
  const clients = Array.isArray(config.client) ? config.client : []
  let rewritten = 0
  for (const client of clients) {
    const android = client?.client_info?.android_client_info
    if (android && typeof android.package_name === 'string') {
      android.package_name = packageName
      rewritten += 1
    }
  }
  if (rewritten === 0) {
    throw new Error(`No android client package_name found in ${filePath}`)
  }
  writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\n`)
  return androidPackageNames(config)
}
