export async function loadXrpl() {
  try {
    return await import('xrpl')
  } catch (error) {
    throw new Error('The `xrpl` package is required for live XRPL execution. Run `npm install xrpl` first.')
  }
}
