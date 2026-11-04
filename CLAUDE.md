# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository context

Fork of [espocrm/espocrm](https://github.com/espocrm/espocrm), based on the **release tag 10.0.11** (version in `package.json`). `origin` is the fork, `upstream` is EspoCRM. Keep core files as close to upstream as possible: official upgrade packages overwrite core files (`js/diff.js` always ships `client/lib/*` and every file in `client/css/espo/`), and upstream merges conflict on any core edit. Put customizations in `custom/` and `client/custom/` instead.

Base the fork on upstream **release tags** (`git fetch upstream --tags`), never on `upstream/master`: `upstream/stable` can trail the latest tag and `upstream/fix` holds unreleased patch fixes. `master` is the unreleased development line toward 10.1 (it already has `upgrades/10.1` and restructured LESS, e.g. RTL moved to `frontend/less/espo/rtl`). To take an upstream release, branch from its tag and cherry-pick the fork's commits; the fork's changes are almost all new files, so this applies cleanly. After that, rebuild the core CSS (`npx grunt less cssmin`) and the custom themes (`npm run build-custom-themes`), because the compiled theme CSS embeds the base variables.

AGPL §7(b): the UI must keep displaying the word "EspoCRM" (logo/footer).

## Commands

Frontend (Node):

```bash
npm ci                              # install (postinstall prepares libs)
npx grunt internal                  # build libs, transpile JS/TS, bundles, templates, CSS -> client/lib, client/css/espo
npx grunt less cssmin               # rebuild only the core theme CSS
npx grunt transpile                 # re-transpile client/src after changes (node js/transpile.js; -f <file> for one file)
npx tsc --noEmit                    # type check (CI: ts-check.yml)
npm run build-custom-themes         # build the fork's custom themes (see "Custom theme")
npx jasmine-browser-runner runSpecs --config=frontend/test/jasmine-browser.json   # frontend specs (needs grunt internal first, chromedriver)
```

PHP (needs `composer install`; PHP/composer are not installed on the WSL host, only in the Docker image without dev deps):

```bash
vendor/bin/phpstan                                   # static analysis, level 8 (phpstan.neon)
vendor/bin/phpunit tests/unit                        # unit tests
vendor/bin/phpunit tests/unit/Espo/Core/Acl/SomeTest.php     # single file
vendor/bin/phpunit --filter testMethodName tests/unit        # single test
npx grunt test && vendor/bin/phpunit tests/integration       # integration: builds into build/, needs a DB and tests/integration/config.php (gitignored)
```

Local instance: `docker compose -f docker-compose.dev.yml up -d` → http://localhost:8090 (throwaway credentials in `docker-compose.dev.yml`, which is local-development-only). It runs the published `espocrm/espocrm` image, whose tag must equal the repo's release tag (pinned in both compose files; `client/css` and `client/img` are mounted over the image, so a mismatch gives CSS that doesn't fit the HTML). It only mounts `client/css`, `client/img`, `custom`, `client/custom` and `data` from the repo — changes in `client/src` or `application/` are NOT visible there. The container entrypoint chowns `custom/` and `client/custom/` to `www-data`, so writing there from the host (including `npm run build-custom-themes`) fails with EACCES until ownership is fixed (`sudo chown -R $USER: <dir>` from a real terminal). After metadata changes: Administration → Clear Cache / Rebuild.

`dev/preview-server.js` (untracked, `node dev/preview-server.js`, port 8088) serves a static mock page for previewing theme CSS only; its markup has hardcoded inline colors and does not reflect real templates.

## Deployment

`docker-compose.yml` is the deployment file (project `espocrm-prod`); `docker-compose.dev.yml` is the local one. Setup: `cp .env.example .env`, fill it in (`.env` is gitignored), then `docker compose up -d`, or `docker compose --profile https up -d` to add Caddy (`deploy/Caddyfile`) with automatic HTTPS and the `/ws` WebSocket route. Required variables fail loudly if unset.

The 10.0.x image only supports mounting `data`, `custom` and `client/custom`, as named volumes; mounting `/var/www/html` is the legacy layout and disables upgrades. Never bind-mount into those three: the entrypoint runs `chown -R` on them at every start, which fails on `:ro` mounts and re-owns repo files on the host. The `theme-installer` one-shot service (same image) copies `custom/Espo/Modules/ModernTheme` and `client/custom/modules/modern-theme` from the repo into the volumes on every `up`; after pulling a theme change run `docker compose up -d` and `docker compose exec espocrm php clear_cache.php`. `ESPOCRM_CONFIG_*` variables are set on the app service only, because every container that has them rewrites the shared config at start. Test a change to these files in a throwaway project (`docker compose -p <name> --env-file <file> ... up -d`, other ports) and tear down only that project with `down -v`.

## Architecture

**Backend** (`application/Espo`, PHP 8.3+, ~2.9k files): REST API at `public/api/v1/` on Slim. Routes in `Resources/routes.json` (plus module `routes.json`) map either to single-action classes (`actionClassName`) or to controllers; the generic CRUD (`/{Entity}`, `/{Entity}/{id}`, `/{Entity}/{id}/{link}`) goes through `Core/Controllers/Record` → record services (`Core/Record`). Custom ORM in `ORM/` driven by `entityDefs`; list filtering (`where`, `primaryFilter`, `boolFilterList`) is translated in `Core/Select`. DI container in `Core/Di` / `Core/Container` — the recommended starting point for backend work. `GET /api/v1/OpenApi` generates an OpenAPI spec from metadata.

**Metadata is the central contract.** JSON in `Resources/metadata/<type>/<Scope>.json` (`entityDefs`, `clientDefs`, `scopes`, `recordDefs`, `selectDefs`, `aclDefs`, `logicDefs`, `fields`, `app`, `themes`, …), plus `Resources/layouts` and `Resources/i18n`. Deep-merged at runtime in order: core → modules (`application/Espo/Modules/Crm`, then `custom/Espo/Modules/*` by `module.json` `order`) → `custom/Espo/Custom/Resources`. Admin tools (Entity/Field/Layout/Label Manager) write into `custom/Espo/Custom/Resources`. Metadata references PHP classes (`*ClassName*` keys) and frontend modules by string id (`"view": "views/fields/varchar"`, `"crm:views/…"`, `controller`, `handler`, `recordViews`, …) — renaming a frontend module breaks every metadata reference to it. All params are described by JSON Schema (`schema/`).

**Frontend** (`client/src`, CRM module in `client/modules/crm/src`): SPA on a custom framework — views extend `client/src/view.ts` (on top of the `bullbone` lib, Backbone-derived) with `setup()` / `afterRender()`, nested child views via `createView(key, 'views/…', {selector})`, Handlebars templates in `client/res/templates` (`.tpl`). Models/collections: `model.ts`, `collection.ts`. Code is mixed JS/TS; Babel transpiles each module to named AMD in `client/lib/transpiled`, and `client/src/loader.js` (custom AMD loader) resolves ids: `views/x` → core, `crm:views/x` → CRM module, `custom:views/x` → `client/custom/src`, `<module>:…` → `client/custom/modules/<module>/src`. `tsconfig.json` paths mirror this. Bundles are defined in `frontend/bundle-config.json`; third-party libs (jQuery, Handlebars, moment, selectize, summernote, FullCalendar…) are declared in `frontend/libs.json` and loaded as `lib!name`. Boot: `html/main.html` rendered by `Core/Utils/ClientManager.php` → `client/src/app.js` loads `App/user`, `Metadata`, `I18n`; with config `isDeveloperMode` the unbundled `client/src/loader.js` is used. The portal is the same app with different ACL (`app-portal.js`).

**Themes**: one metadata file per theme in `Resources/metadata/themes/`; `frontend/less/<theme>/main.less` → `client/css/espo/<theme>.css`. Non-Espo themes `@import (css) "espo.css"` and only override LESS `*-value` variables, which `frontend/less/espo/root-variables.less` turns into CSS custom properties. `body { --theme-name }` must equal the metadata key (checked by `client/src/theme-manager.js`).

## Custom theme (this fork)

The fork's reskin lives outside core as module `ModernTheme` (themes `Modern`, `ModernLight`, `ModernDark`):

- Metadata/i18n: `custom/Espo/Modules/ModernTheme/Resources/` (whitelisted in `.gitignore`).
- LESS sources: `frontend/less-custom/modern/` — `value-variables.less` / `light-variables.less` / `dark-variables.less` hold only the changed variables and are imported right after the stock variable files they override; `overrides.less` holds rule changes appended after the runtime import of stock `espo.css`.
- Output (committed): `client/custom/modules/modern-theme/css/*.css`, built by `js/build-custom-themes.js`.

When adding to `overrides.less`, a rule appended after `espo.css` wins over later stock rules of equal specificity (e.g. `.label` vs `.label-md`, `.btn-default` vs `.btn-text`); re-assert those stock rules at the end of the file. Do not edit `frontend/less/espo/*` for visual changes.
