/** @type {import('next').NextConfig} */
export default {
  // Do not scatter agent instruction files into a repo that already has its own.
  agentRules: false,
  // The core is authored with explicit .ts specifiers so Node can run the CLI
  // without a build step. The bundler needs to be told how to resolve those.
  turbopack: {
    resolveExtensions: ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.json'],
  },
  webpack: (config) => {
    config.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'], '.ts': ['.ts', '.tsx'] }
    return config
  },
  serverExternalPackages: ['pg'],
}
