import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import AdblockerPlugin from 'puppeteer-extra-plugin-adblocker';

puppeteer.use(StealthPlugin());
puppeteer.use(AdblockerPlugin({ blockTrackers: true }));


async function setupRequestLogging(page) {
	page.on('request', request => {
		console.log(`➡️ ${request.method()} ${request.url()}`);
	});

	page.on('response', async response => {
		try {
			const url = response.url();
			const status = response.status();

			console.log(`⬅️ ${status} ${url}`);
		} catch (e) {
			console.error(`   ❌ Error processing response: ${response.url()}`, e);
		}
	});
}

async function configureRealisticBrowser(page) {
    await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36'
    );

    await page.setViewport({
        width: 1280,
        height: 800,
        deviceScaleFactor: 1,
    });

    await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
    });
}


export async function launchBrowser(options={}) {
	const userDataDir = options['user-data'];
    const browser = await puppeteer.launch({
        headless: options.headless,
        userDataDir, // ← this persists everything
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
        ],
        defaultViewport: null
    });

    const page = await browser.newPage();
    await configureRealisticBrowser(page);
	if (options.debug) {
    	await setupRequestLogging(page);
	}

	return { browser, page };
}
