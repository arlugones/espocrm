/**
 * Builds custom (upgrade-safe) themes that live outside the core LESS tree.
 *
 * Sources: frontend/less-custom/<theme>/*.less
 * Output:  client/custom/modules/<module>/css/*.css
 *
 * Usage:
 *   node js/build-custom-themes.js           Build minified CSS.
 *   node js/build-custom-themes.js --no-min  Build unminified CSS (debugging).
 *   node js/build-custom-themes.js --out-dir <dir>  Write all files to another directory.
 *
 * The stock espo.css (client/css/espo/espo.css) must be built as well, since
 * the custom themes import it at runtime.
 */

const fs = require('fs');
const path = require('path');
const less = require('less');
const CleanCSS = require('clean-css');

const rootDir = path.resolve(__dirname, '..');

const themeList = [
    {
        sourceDir: 'frontend/less-custom/modern',
        outputDir: 'client/custom/modules/modern-theme/css',
        files: {
            'main.less': 'modern.css',
            'iframe.less': 'modern-iframe.css',
            'light.less': 'modern-light.css',
            'light-iframe.less': 'modern-light-iframe.css',
            'dark.less': 'modern-dark.css',
            'dark-iframe.less': 'modern-dark-iframe.css',
        },
    },
];

const minify = !process.argv.includes('--no-min');

const outDirIndex = process.argv.indexOf('--out-dir');
const outDirOverride = outDirIndex > 0 ? path.resolve(process.argv[outDirIndex + 1]) : null;

async function build() {
    for (const theme of themeList) {
        const outputDir = outDirOverride || path.join(rootDir, theme.outputDir);

        fs.mkdirSync(outputDir, {recursive: true});

        for (const [source, target] of Object.entries(theme.files)) {
            const sourcePath = path.join(rootDir, theme.sourceDir, source);
            const targetPath = path.join(outputDir, target);

            const result = await less.render(fs.readFileSync(sourcePath, 'utf8'), {
                filename: sourcePath,
            });

            let css = result.css;

            if (minify) {
                // Keep `@import` of the stock espo.css as a runtime import.
                const minified = new CleanCSS({inline: false}).minify(css);

                if (minified.errors.length) {
                    throw new Error(`${source}: ${minified.errors.join('; ')}`);
                }

                css = minified.styles;
            }

            fs.writeFileSync(targetPath, css);

            console.log(`${path.relative(rootDir, sourcePath)} -> ${path.relative(rootDir, targetPath)}`);
        }
    }
}

build().catch(e => {
    console.error(e.message || e);

    process.exit(1);
});
