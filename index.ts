import * as Jimp from "jimp";
import { convertSurfaceToStandardPngData } from "ukagaka-surface-to-standard-png";
// eslint-disable-next-line @typescript-eslint/camelcase
import { txt_to_data } from "surfaces_txt2yaml";
import { FSO, FileSystemObject } from "fso";
import * as iconv from "iconv-lite";
import * as chardet from "chardet";
import findCharset from "find-charset";

export function getSurfacesInfo(shellDirPath: string) {
    const shellDir = new FSO(shellDirPath);
    const files = shellDir.childrenSync();
    const surfacesTxts = files
        .filter(f => /^surfaces.*\.txt/.test(f.basename().path))
        .sort((a, b) => {
            const aname = a.basename().path;
            const bname = b.basename().path;
            if (aname === "surfaces.txt") return -1;
            if (bname === "surfaces.txt") return 1;
            // eslint-disable-next-line no-nested-ternary
            return aname > bname ? 1 : aname < bname ? -1 : 0;
        });

    if (!surfacesTxts.length) return undefined;

    const surfacesTxt = surfacesTxts
        .map(f => f.readFileSync())
        .map(b =>
            iconv.decode(b, findCharset(b, "charset,", { charsetEndMark: 0x0d }) || chardet.detect(b) || "Shift_JIS"),
        )
        .join("\n");
    return txt_to_data(surfacesTxt, { compatible: "ssp-lazy" });
}

class ShellsCache {
    shellDir: FileSystemObject;

    shells: { [filename: string]: Jimp } = {};

    writeShells: { [filename: string]: boolean } = {};

    constructor(shellDirPath: string) {
        this.shellDir = new FSO(shellDirPath);
    }

    async fetch(filename: string, markWrite = false) {
        if (markWrite) this.writeShells[filename] = true;
        // eslint-disable-next-line no-return-assign
        return (
            this.shells[filename] ||
            (this.shells[filename] = await convertSurfaceToStandardPngData(this.shellDir.join(filename).path))
        );
    }

    async fetchIfExists(filename: string, markWrite = false) {
        return this.shellDir.join(filename).existsSync() ? this.fetch(filename, markWrite) : undefined;
    }

    add(filename: string, content: Jimp, markWrite = true) {
        this.shells[filename] = content;
        if (markWrite) this.writeShells[filename] = true;
    }

    markWrite(filename: string) {
        this.writeShells[filename] = true;
    }

    write(destinationDirPath: string) {
        const destinationDir = new FSO(destinationDirPath);
        return Promise.all(
            Object.keys(this.writeShells).map(filename =>
                this.shells[filename].writeAsync(destinationDir.join(filename).path),
            ),
        );
    }
}

function findShellFilenameById(shellFilenames: string[], is: number) {
    return shellFilenames.find(filename => {
        const matched = filename.match(/^surface(\d+).png$/);
        return matched && Number(matched[1]) === is;
    });
}

export async function convert(shellDirPath: string, destinationPath: string) {
    const surfacesInfo = getSurfacesInfo(shellDirPath);
    const shellsCache = new ShellsCache(shellDirPath);
    const shellDir = new FSO(shellDirPath);
    const shellFilenames = shellDir
        .childrenSync()
        .filter(f => f.extname() === ".png")
        .map(f => f.basename().path);
    if (surfacesInfo) {
        /* eslint-disable no-await-in-loop */
        // eslint-disable-next-line no-restricted-syntax
        for (const surfaceName of Object.keys(surfacesInfo.surfaces)) {
            const surface = surfacesInfo.surfaces[surfaceName];
            if (surface.elements) {
                const element0filename = findShellFilenameById(shellFilenames, surface.is);
                let shell = element0filename ? await shellsCache.fetchIfExists(element0filename) : undefined;
                // eslint-disable-next-line no-restricted-syntax
                for (const elementName of Object.keys(surface.elements).sort(
                    (a, b) => surface.elements[a].is - surface.elements[b].is,
                )) {
                    const element = surface.elements[elementName];
                    const shellElement = await shellsCache.fetch(element.file);
                    if (shell && element.is !== 0) {
                        switch (element.type) {
                            case "base":
                            case "overlay":
                                shell.composite(shellElement, element.x, element.y, {
                                    mode: Jimp.BLEND_SOURCE_OVER,
                                    opacitySource: 1,
                                    opacityDest: 1,
                                });
                                break;
                            case "interpolate":
                                shell.composite(shellElement, element.x, element.y, {
                                    mode: Jimp.BLEND_DESTINATION_OVER,
                                    opacitySource: 1,
                                    opacityDest: 1,
                                });
                                break;
                            default:
                                throw new Error(
                                    `composite method [${element.type}] is not supported in ${surfaceName}.${elementName}`,
                                );
                        }
                    } else {
                        shell = shellElement;
                    }
                }
                if (shell) shellsCache.add(`surface${surface.is}-composited.png`, shell, true);
            } else {
                const element0filename = findShellFilenameById(shellFilenames, surface.is);
                if (element0filename) await shellsCache.fetch(element0filename, true);
            }
        }
        /* eslint-enable no-await-in-loop */
    } else {
        await Promise.all(shellFilenames.map(sf => shellsCache.fetch(sf, true)));
    }
    await shellsCache.write(destinationPath);
}
