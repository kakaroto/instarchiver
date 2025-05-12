import readline from 'readline-sync';
import fs from 'fs-extra';
import path from 'path';
import { launchBrowser } from './browser.js';
import { waitMS, sanitizeFilename } from './utils.js';
import util from 'util';


export default class Instagram {
	constructor(options = {}) {
		this.browser = null;
		this.page = null;
		this.options = Object.assign({
			headless: true,
			logout: false,
			userData: null,
			output: './output',
			debug: false,
		}, options);
		this._queryId = 0;
		this._queryCache = {};
		fs.mkdirsSync(this.options.output);
	}

	async close() {
		if (this.options.logout && this.page) {
			await this.logout();
		}

		if (this.browser) {
			await this.browser.close();
		}
	}
	async exit(code) {
		await this.close();
		process.exit(code);
	}
	
	async _ensurePageExists() {
		if (this.page) return this.page;
		const { browser, page } = await launchBrowser(this.options);
		this.browser = browser;
		this.page = page;
		this.page.on('response', this._onPageResponse.bind(this));
		return this.page;
	}
	async _onPageResponse(response) {
		const contentType = response.headers()['content-type'] || '';
		if (contentType.includes('application/json') && response.url().match(/instagram\.com\/graphql\/query/)) {
			const json = await response.json();
			const queryName = Object.keys(json?.data).find(key => key.startsWith("xdt_api")) || Object.keys(json?.data)[0];
			const timestamp = Date.now();
			const safeName = sanitizeFilename(queryName || 'data');
			const filename = path.join(this.options.output, `${timestamp}_${safeName}_${this._queryId++}.json`);
			await fs.writeFile(filename, JSON.stringify(json, null, 2));
			console.log(`Received graphql response: ${queryName} (${response.status()})`);
			this._queryCache[queryName] = this._queryCache[queryName] || [];
			this._queryCache[queryName].push(json);
		}
	}
	
	_findObjectWithKey(data, keyToMatch, { startsWith = false } = {}) {
		if (typeof data !== 'object' || data === null) return null;
	
		// If it's an object, check its keys
		if (!Array.isArray(data)) {
			for (const key of Object.keys(data)) {
				if ((startsWith && key.startsWith(keyToMatch)) || (!startsWith && key === keyToMatch)) {
					return data;
				}
			}
		}
	
		// Recurse into arrays and objects
		for (const value of Array.isArray(data) ? data : Object.values(data)) {
			const found = this._findObjectWithKey(value, keyToMatch, { startsWith });
			if (found) return found;
		}
	
		return null;
	}
	
	async _findObjectFromPage(key, startsWith = false) {
		const pageContent = await this.page.evaluate(() => {
			// This function runs in the browser context
			// eslint-disable-next-line no-undef
			return Array.from(document.querySelectorAll('script[type="application/json"]'))
				.map(script => JSON.parse(script.innerText));
		});
	
		for (const obj of pageContent) {
			const found = await this._findObjectWithKey(obj, key, { startsWith });
			if (found) return found;
		}
	
		return null;
	}

	getHighlights() {
		const highlights = this._queryCache['highlights'];
		if (!highlights) {
			console.error('❌ No highlights found.');
			return [];
		}
		const highlightData = highlights[0]?.data?.highlights?.edges;
		if (!highlightData) {
			console.error('❌ No highlight data found.');
			return [];
		}
		return highlightData.map(h => {
			const highlightId = h.node.id.split(':')[1];
			return {
				id: h.node.id,
				title: h.node.title,
				url: `https://www.instagram.com/stories/highlights/${highlightId}/`,
				thumbnail: h.node.cover_media?.cropped_image_version?.url,
			}
		});
	}
	
	getHighlightData(highlightId) {
		const feeds = this._queryCache['xdt_api__v1__feed__reels_media__connection'];
		if (!feeds) {
			console.error('❌ No feeds found.');
			return null;
		}
		if (!highlightId.startsWith('highlight:')) {
			highlightId = `highlight:${highlightId}`;
		}
		const highlightFeed = feeds.find(f => (f.data?.xdt_api__v1__feed__reels_media__connection?.edges || []).find(e => e.node?.id == highlightId));
		if (!highlightFeed) {
			console.error(`❌ Highlight ${highlightId} not found in feeds data.`);
			console.log(util.inspect(feeds, { depth: null, colors: true }));
			return null;
		}
		const highlightData = highlightFeed.data?.xdt_api__v1__feed__reels_media__connection?.edges.find(e => e.node?.id == highlightId);
		if (!highlightData) {
			console.error('❌ No highlight data found.');
			console.log(util.inspect(highlightFeed, { depth: null, colors: true }));
			return null;
		}
		return highlightData.node;
	}

	getMediaData(mediaCode) {
		const reels = this._queryCache['xdt_api__v1__media__shortcode__web_info'];
		if (!reels) {
			console.error('❌ No medias found.');
			return null;
		}
		const reelItems = reels.find(r => (r.data?.xdt_api__v1__media__shortcode__web_info?.items || []).find(n => n.code == mediaCode));
		if (!reelItems) {
			console.error(`❌ Media ${mediaCode} not found in medias web info.`);
			return null;
		}
		const reelData = reelItems.data?.xdt_api__v1__media__shortcode__web_info?.items.find(n => n.code == mediaCode);
		if (!reelData) {
			console.error('❌ No media data found.');
			return null;
		}
		return reelData;
	}


	
	async promptCredentials() {
		console.log('🔐 You need to login in order to use this tool. Enter your username/password below,\nor alternatively, launch with --no-headless and --user-data options and login directly into the browser window then restart the tool, keeping the --user-data option.');
		const username = readline.question('Enter Instagram username: ');
		const password = readline.question('Enter Instagram password: ', { hideEchoBack: true });
		return { username, password };
	}

	async loginIfNeeded() {
		const loginSelector = 'input[name="username"]';
		const needsLogin = await this.page.$(loginSelector);
		if (!needsLogin) return;
		const { username, password } = await this.promptCredentials();

		console.log('🔐 Logging into Instagram...');

		await this.page.type('input[name="username"]', username, { delay: 100 });
		await this.page.type('input[name="password"]', password, { delay: 100 });

		await this.page.click('button[type="submit"]');
		await this.page.waitForNavigation({ waitUntil: 'networkidle2' });

		// Check for login failure
		const loginError = await this.page.$('p[data-testid="login-error-message"]');
		if (loginError) {
			console.error('❌ Login failed. Please check your credentials.');
			this.exit(1);
		}
	}

	async archiveInstagramPages(pagesToArchive) {
		await this._ensurePageExists();

		console.log('🌐 Navigating to Instagram...');
		await this.page.goto('https://www.instagram.com', { waitUntil: 'networkidle2' });

		await this.loginIfNeeded();

		console.log('✅ Logged in.');
		await this.page.setDefaultNavigationTimeout(0);

		for (const pageUrl of pagesToArchive) {
			await this.archivePage(pageUrl);
		}

		console.log('✅ Finished archiving all pages.');
		await this.close();
	}

	async archivePage(pageUrl) {
		console.log(`📸 Archiving ${pageUrl}...`);
		let type = 'reel';
		if (pageUrl.startsWith('@')) {
			pageUrl = pageUrl.slice(1);
		}
		if (pageUrl.startsWith('http')) {
			if (pageUrl.includes("/highlights/")) {
				type = 'highlight';
			} else if (pageUrl.match(/instagram\.com\/[^/]+\/?$/)) {
				type = 'profile';
			}
		} else {
			if (pageUrl.startsWith('highlight:')) {
				const highlightId = pageUrl.split(':')[1];
				pageUrl = `https://www.instagram.com/stories/highlights/${highlightId}/`;
				type = 'highlight';
			} else {
				pageUrl = `https://www.instagram.com/${pageUrl}`;
				type = 'profile';
			}
		}
		if (!pageUrl.startsWith('https://www.instagram.com/')) {
			console.error('❌ Invalid URL format. Please provide a valid Instagram URL.');
			return;
		}

		await this.page.goto(pageUrl, { waitUntil: 'networkidle2' });

		// Wait for the page to load
		await waitMS(2000, 1000); // Wait for 2 to 3 seconds to ensure the page is fully loaded

		if (type === 'profile') {
			const highlights = this.getHighlights();
			if (highlights) {
				console.log(`📸 Found ${highlights.length} highlights.`);
				console.log(highlights.map(h => h.title).join(', '));
				for (const highlight of highlights) {
					const highlightId = highlight.id;
					console.log(`📸 Archiving highlight ${highlight.title} (${highlightId})...`);
					const highlightData = this.getHighlightData(highlightId);
					if (!highlightData) {
						await this.archivePage(highlight.url);
					} else {
						console.log(`📸 Highlight ${highlight.title} has ${highlightData.items?.length} items`);
					}
					break;
				}
			}
		} else if (type === 'reel') {
			const queryName = 'xdt_api__v1__media__shortcode__web_info';
			const data = await this._findObjectFromPage(queryName);
			if (!data) {
				console.error('❌ No reel data found in page.');
				return;
			}
			this._queryCache[queryName] = this._queryCache[queryName] || [];
			this._queryCache[queryName].push({data: data});
			const mediaCode = pageUrl.split("/").filter(a => a).pop();
			let mediaData = this.getMediaData(mediaCode);
			if (!mediaData) {
				console.error('❌ No reel data found in query cache.');
				mediaData = data?.xdt_api__v1__media__shortcode__web_info?.items[0];
			}
			console.log(`📸 Reel ${mediaCode} has URL: ${mediaData.video}`);
			const output = path.join(this.options.output, type, sanitizeFilename(mediaCode));
			await fs.mkdirs(output);
			await fs.writeFile(path.join(output, "media.json"), JSON.stringify(mediaData, null, 2));
		} else if (type === 'highlight') {
			const queryName = 'xdt_api__v1__feed__reels_media__connection';
			const data = await this._findObjectFromPage(queryName);
			if (!data) {
				console.error('❌ No highlight data found in page.');
				return;
			}
			this._queryCache[queryName] = this._queryCache[queryName] || [];
			this._queryCache[queryName].push({data: data});
			const highlightId = pageUrl.split("/").filter(a => a).pop();
			let highlightData = this.getHighlightData(highlightId);
			if (!highlightData) {
				console.error('❌ No highlight data found in query cache.');
				highlightData = data?.xdt_api__v1__feed__reels_media__connection?.edges[0].node;
				console.log(util.inspect(highlightData, { depth: null, colors: true }));
			}
			console.log(`📸 Highlight ${highlightData.title} has ${highlightData.items?.length} items`);
			const output = path.join(this.options.output, type, sanitizeFilename(highlightData.title));
			await fs.mkdirs(output);
			await fs.writeFile(path.join(output, "highlight.json"), JSON.stringify(highlightData, null, 2));
		}

		console.log(`📸 Finished archiving ${pageUrl}.`);
	}

	async logout() {
		console.log('🔒 Logging out of Instagram...');
		await this.page.goto('https://www.instagram.com/accounts/logout/', { waitUntil: 'networkidle2' });
		await waitMS(2000) // Wait for logout to complete
		console.log('🔒 Successfully logged out.')
		await this.page.close();
	}
}
