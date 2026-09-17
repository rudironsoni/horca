// Horca CLI product copy.
//
// The CLI's user-facing help text is upstream Orca copy spread across many
// modules. Gate C does not perform a global rename of that copy (see the Gate C
// plan: no global search-and-replace). Instead this module owns the single
// product-name mapping and the help renderer applies it, so every help surface
// identifies Horca without touching hundreds of upstream strings.
//
// The values are duplicated from product.json on purpose and are verified
// against it by scripts/verify-product-identity.mjs.

export const HORCA_PRODUCT_NAME = 'Horca'
export const HORCA_CLI_COMMAND_NAME = 'horca'

/** Map upstream product copy to Horca naming at render time. */
export function asHorcaProductCopy(text: string): string {
  return text
    .replace(/\bOrca\b/g, HORCA_PRODUCT_NAME)
    .replace(/(^|[\s`'">])orca(?=[\s<`'"]|$)/g, `$1${HORCA_CLI_COMMAND_NAME}`)
}
