import { convert } from "./index";

if (process.argv.length !== 4) {
    // eslint-disable-next-line no-console
    console.warn("Usage: this /shell/master /dst");
    process.exit(1);
}

convert(process.argv[2], process.argv[3]);
