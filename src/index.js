import minimist from 'minimist';
import Instagram from './instagram.js';


async function main() {
    const args = minimist(process.argv.slice(2), {
        boolean: ['headless', 'logout', 'debug', 'update', 'incognito'],
        string: ['user-data', 'output'],
        alias: {
            h: 'help',
            o: 'output',
            u: 'user-data',
            l: 'logout',
            d: 'debug',
        },
        default: {
            headless: true,
            logout: false,
            debug: false,
            incognito: true,
        },
    });

    if (args.help || args.h) {
        console.log('Usage: node index.js [options] [@username,highglight:id,url...]');
        console.log('Options:');
        console.log('  --output                 Output directory for saved pages');
        console.log('  --user-data              User data directory (required to save cookies)');
        console.log('  --update                 Update an existing archive');
        console.log('  --no-incognito           Do not use an incognito window for downloading public media reels');
        console.log('  --no-headless            Run browser in non-headless mode');
        console.log('  --logout                 logout when done');
        console.log('  --debug                  Enable debug mode');
        console.log('  --help, -h               Show this help message');
        process.exit(0);
    }
    
    const pagesToArchive = args._;

    if (pagesToArchive.length === 0) {
        console.error('❌ No pages to archive. Please provide a list of Instagram pages.');
        process.exit(1);
    }
    if (!args.output) {
        console.error('❌ No output directory specified. Please provide an output directory using --output.');
        process.exit(1);
    }

    const inst = new Instagram(args);

    await inst.archiveInstagramPages(pagesToArchive);

    process.exit(0);
}

main().catch(err => {
    console.error('❌ Unexpected error:', err);
});
