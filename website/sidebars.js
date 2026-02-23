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
        'Configuration',
        'Authentication',
        'Docker-Deployment',
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
