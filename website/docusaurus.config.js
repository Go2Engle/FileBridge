// @ts-check

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'FileBridge',
  tagline: 'Automated File Transfer Scheduling',
  favicon: 'img/logo.png',

  url: 'https://go2engle.com',
  baseUrl: '/FileBridge/docs/',

  onBrokenLinks: 'warn',
  onBrokenMarkdownLinks: 'warn',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          // Docs-only mode: docs served at /docs/ root instead of /docs/docs/
          routeBasePath: '/',
          sidebarPath: './sidebars.js',
          // Point directly at the existing docs/ folder in the repo root
          path: '../docs',
          // Wiki-style links (no .md extension, no ./) — don't fail the build
          editUrl: undefined,
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      }),
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      colorMode: {
        defaultMode: 'dark',
        disableSwitch: false,
        respectPrefersColorScheme: true,
      },
      navbar: {
        title: 'FileBridge',
        logo: {
          alt: 'FileBridge Logo',
          src: 'img/logo.png',
          href: 'https://go2engle.com',
          target: '_self',
        },
        items: [
          {
            type: 'docSidebar',
            sidebarId: 'docsSidebar',
            position: 'left',
            label: 'Documentation',
          },
          {
            href: 'https://go2engle.com',
            label: 'Home',
            position: 'right',
          },
          {
            href: 'https://github.com/cengle/FileBridge',
            label: 'GitHub',
            position: 'right',
          },
        ],
      },
      footer: {
        style: 'dark',
        links: [
          {
            title: 'Docs',
            items: [
              { label: 'Getting Started', to: '/Getting-Started' },
              { label: 'Configuration', to: '/Configuration' },
              { label: 'API Reference', to: '/API-Reference' },
            ],
          },
          {
            title: 'More',
            items: [
              { label: 'Home', href: 'https://go2engle.com' },
              { label: 'GitHub', href: 'https://github.com/cengle/FileBridge' },
            ],
          },
        ],
        copyright: `Copyright © ${new Date().getFullYear()} FileBridge. Built with Docusaurus.`,
      },
      prism: {
        theme: require('prism-react-renderer').themes.oneDark,
        darkTheme: require('prism-react-renderer').themes.oneDark,
        additionalLanguages: ['bash', 'json', 'yaml', 'typescript'],
      },
    }),
};

module.exports = config;
