export function pluginAssetContentSecurityPolicy(allowedOrigins: ReadonlySet<string>): string {
  const origins = [...allowedOrigins].flatMap((value) => {
    try {
      const parsed = new URL(value)
      return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.origin === value ? [parsed.origin] : []
    } catch { return [] }
  })
  const assets = origins.length ? [...new Set(origins)].join(' ') : "'none'"
  return `sandbox allow-scripts allow-forms; default-src 'none'; style-src ${assets} 'unsafe-inline'; script-src ${assets}; img-src ${assets} data:; font-src ${assets}; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors ${assets}`
}
