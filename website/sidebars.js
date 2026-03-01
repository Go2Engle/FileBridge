// @ts-check

/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  docsSidebar: [
    'Home',
    {
      type: 'category',
      label: 'Getting Started',
      collapsed: false,
      items: [
        'Getting-Started',
        'Server-Install',
        'Docker-Deployment',
        'Configuration',
        'Authentication',
      ],
    },
    {
      type: 'category',
      label: 'Core Concepts',
      items: [
        'Connections',
        'Jobs',
        'Transfer-Engine',
      ],
    },
    {
      type: 'category',
      label: 'Hooks',
      items: [
        'Hooks',
        'Hook-Library',
        'Hook-Template-Authoring',
      ],
    },
    {
      type: 'category',
      label: 'Operations',
      items: [
        'Database-Backups',
        'Health-Check',
        'Audit-Logging',
        'Structured-Logging',
      ],
    },
    {
      type: 'category',
      label: 'Reference',
      items: [
        'API-Reference',
        'Architecture',
        'Security',
        'Extending-FileBridge',
      ],
    },
  ],
};

module.exports = sidebars;
