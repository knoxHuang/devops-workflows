
const Download = require('download');
const { join } = require('path');
const { parse } = require('url');
const del = require('del');
const globby = require('globby');
const fse = require('fs-extra');
const program = require('commander');
const Chalk = require('chalk');

const { getSettings, tooltip, sleep } = require('./utils');

const TempDir = '.downloading';

var httpProxies = getSettings().httpProxies;

program
    .option('--url <url>')
    .option('--dir <path>')
    .parse(process.argv);

async function download(url, dir, retryTimes = 5) {
    let isLan = parse(url).hostname.startsWith('192.168.');
    let proxy = (!isLan && httpProxies.length > 0) ? httpProxies[0] : undefined;

    if (proxy) {
        tooltip(Chalk.grey(`downloading "${Chalk.white(url)}" via proxy ${proxy}`));
    }
    else {
        tooltip(Chalk.grey(`downloading "${Chalk.white(url)}"`));
    }

    try {
        await Download(url, dir, {
            mode: '755',
            extract: true,
            strip: 0,
            proxy
        });
    }
    catch (err) {
        if (err.statusCode !== 404) {
            if (err.code === 'ECONNRESET' && proxy) {
                // proxy error
                var currentProxy = httpProxies.length > 0 ? httpProxies[0] : undefined;
                var proxyChanged = proxy !== currentProxy;
                if (!proxyChanged) {
                    httpProxies.shift();
                    if (httpProxies.length > 0) {
                        tooltip.pin(Chalk.grey(`switch proxy to ${Chalk.white(httpProxies[0])}`));
                    }
                    else {
                        tooltip.pin(Chalk.yellow(`bypass all proxies`));
                    }
                }
                await download(url, dir, retryTimes);
                return;
            }
            else if (retryTimes > 0) {
                tooltip.pin(Chalk.yellow(`retry download "${url}" - ${retryTimes - 1}`));
                await download(url, dir, retryTimes - 1);
                return;
            }
        }
        tooltip.pin();
        throw err;
    }

    // success
    tooltip.clear();
}

// download zip and extract it
(async function () {
    let url = program.url;
    let dir = program.dir;
    if (!url || !dir) {
        console.error('Invalid parameter');
        process.exit(1);
    }

    let tmpDir = join(dir, TempDir);

    await del(tmpDir, { force: true });
    await download(url, tmpDir);

    // strip directory manually

    let folders = await globby(['*', '!__MACOSX'], { cwd: tmpDir, onlyFiles: false });
    if (folders.length === 0) {
        console.error(`No file extracted from ${url}`);
        process.exit(1);
    }
    else if (folders.length > 1) {
        console.error(`More than 1 files extracted from ${url}, files: ${folders}`);
        process.exit(1);
    }
    let rootFolder = join(tmpDir, folders[0]);
    if (!(await fse.stat(rootFolder)).isDirectory()) {
        console.error(`The file "${rootFolder}" extracted from ${url} is not a directory.`);
        process.exit(1);
    }

    let files = await globby(['*', '!__MACOSX'], { cwd: rootFolder, onlyFiles: false, dot: true });
    for (let i = 0; i < files.length; ++i) {
        let filename = files[i];
        await fse.move(join(rootFolder, filename), join(dir, filename), { overwrite: true });
    }

    // purge

    await del(tmpDir, { force: true });
    await sleep(50);    // ensure handle released on Windows
})();
