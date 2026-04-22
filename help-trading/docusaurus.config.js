// @ts-check
import {themes as prismThemes} from 'prism-react-renderer';

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'Trading System Help',
  tagline: 'Documentazione operativa e tecnica del platform stack',
  favicon: 'img/favicon.ico',

  future: {
    v4: true,
  },

  url: 'https://help.trading.example.com',
  baseUrl: '/',

  organizationName: 'expovin',
  projectName: 'help.trading',

  onBrokenLinks: 'throw',

  markdown: {
    mermaid: true,
  },

  themes: ['@docusaurus/theme-mermaid'],

  i18n: {
    defaultLocale: 'it',
    locales: ['it'],
  },

  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          sidebarPath: './sidebars.js',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      }),
    ],
  ],

  plugins: [
    [
      '@easyops-cn/docusaurus-search-local',
      {
        indexDocs: true,
        indexBlog: false,
        indexPages: false,
        docsRouteBasePath: '/docs',
        language: ['it'],
        hashed: true,
        highlightSearchTermsOnTargetPage: true,
      },
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      image: 'img/docusaurus-social-card.jpg',
      colorMode: {
        defaultMode: 'light',
        disableSwitch: false,
        respectPrefersColorScheme: true,
      },
      navbar: {
        title: 'Trading Help',
        logo: {
          alt: 'Trading Help Logo',
          src: 'img/logo.svg',
        },
        items: [
          {
            type: 'docSidebar',
            sidebarId: 'tutorialSidebar',
            position: 'left',
            label: 'Guide',
          },
          {
            to: '/docs/developer-esterno-api/overview',
            label: 'API',
            position: 'left',
          },
          {
            type: 'search',
            position: 'left',
          },
          {
            href: 'https://github.com/settings/organizations',
            label: 'Repository',
            position: 'right',
          },
        ],
      },
      footer: {
        style: 'light',
        links: [
          {
            title: 'Guide',
            items: [
              {label: 'Utente', to: '/docs/utente/overview'},
              {label: 'Developer', to: '/docs/developer-esterno-api/overview'},
              {label: 'Amministratore', to: '/docs/amministratore/overview'},
              {label: 'API', to: '/docs/developer-interno/overview'},
            ],
          },
          {
            title: 'Sistema',
            items: [
              {label: 'Intro', to: '/docs/'},
              {label: 'Architettura codice', to: '/docs/developer-interno/mappa-cartelle'},
            ],
          },
        ],
        copyright: `Copyright © ${new Date().getFullYear()} Trading System`,
      },
      prism: {
        theme: prismThemes.github,
        darkTheme: prismThemes.dracula,
      },
    }),
};

export default config;
