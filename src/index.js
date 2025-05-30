import minimist from 'minimist';
import Instagram from './instagram.js';


async function main() {
    const args = minimist(process.argv.slice(2), {
        boolean: ['headless', 'logout', 'debug', 'update', 'incognito', 'highlights', 'stories', 'feed', 'saved', 'pause'],
        string: ['user-data', 'output'],
        alias: {
            h: 'help',
            o: 'output',
            u: 'user-data',
            l: 'logout',
            v: 'debug',
            d: 'user-data',
        },
        default: {
            headless: true,
            logout: false,
            debug: false,
            incognito: true,
            update: false,
            highlights: true,
            stories: true,
            feed: true,
            saved: true,
        },
    });

    if (args.help || args.h) {
        console.log('Usage: node index.js [options] [@username,highglight:id,url...]');
        console.log('Options:');
        console.log('  --output, -o             Output directory for saved pages');
        console.log('  --user-data, -d          User data directory (required to save cookies)');
        console.log('  --update                 Update an existing archive');
        console.log('  --highlights             Archive highlights from a user (default: true)');
        console.log('  --stories                Archive stories from a user (default: true)');
        console.log('  --feed                   Archive feed posts from a user (default: true)');
        console.log('  --saved                  Archive saved posts from a user (default: true)');
        console.log('  --no-incognito           Do not use an incognito window for downloading public media reels');
        console.log('  --no-headless            Run browser in non-headless mode');
        console.log('  --logout, -l             logout when done');
        console.log('  --pause                  Pause once done until user presses a key');
        console.log('  --debug, -v              Enable debug mode');
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

    if (args.pause) {
        console.log('Press any key to exit...');
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.on('data', () => {
            process.exit(0);
        });
    } else {
        process.exit(0);
    }
}

main().catch(err => {
    console.error('❌ Unexpected error:', err);
});
