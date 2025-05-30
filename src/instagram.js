import readline from 'readline-sync';
import fs from 'fs-extra';
import path from 'path';
import { pipeline } from 'stream';
import fetch from 'node-fetch';
import contentDisposition from 'content-disposition';

import { launchBrowser } from './browser.js';
import { waitMS, sanitizeFilename, formatDateForFilename } from './utils.js';
import util from 'util';


const streamPipeline = util.promisify(pipeline);
export default class Instagram {
	constructor(options = {}) {
		this.browser = null;
		this.incognito_browser = null;
		this.page = null;
		this.incognito = null;
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
	async _ensureIncognitoExists() {
		if (this.incognito) return this.incognito;
		const options = {...this.options};
		delete options['user-data'];
		const { browser, page } = await launchBrowser(options);
		this.incognito_browser = browser;
		this.incognito = page;
		this.incognito.on('response', this._onPageResponse.bind(this));
		return this.incognito;
	}

	async _saveResponse(data, queryName) {
		const timestamp = Date.now();
		const safeName = sanitizeFilename(queryName || 'data');
		const filename = path.join(this.options.output, `${timestamp}_${safeName}_${this._queryId++}.json`);
		await fs.writeFile(filename, JSON.stringify(data, null, 2));
		this._queryCache[queryName] = this._queryCache[queryName] || [];
		this._queryCache[queryName].push(data);
	}

	async _onPageResponse(response) {
		try {
			const contentType = response.headers()['content-type'] || '';
			if (contentType.includes('application/json') && response.url().match(/instagram\.com\/graphql\/query/)) {
				const json = await response.json();
				const queryName = Object.keys(json?.data || {}).find(key => key.startsWith("xdt_api")) || Object.keys(json?.data || {})[0];
				if (queryName) {
					console.log(`Received graphql response: ${queryName} (${response.status()})`);
					await this._saveResponse(json, queryName);
				}
			}
		} catch (err) {
			console.error(`Error processing response from ${response.url()}:`, err);
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
	
	async _findObjectFromPage(key, { startsWith = false, page = this.page } = {}) {
		const pageContent = await page.evaluate(() => {
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

	getUserData(username) {
		const users = this._queryCache['user'];
		if (!users) {
			console.error('❌ No user data found.');
			return null;
		}
		const userData = users.find(u => !username || u?.data?.user?.username == username);
		if (!userData) {
			console.error('❌ No user data found in query cache.');
			return null;
		}
		return userData.data.user;
	}

	getHighlights(username) {
		const highlights = this._queryCache['highlights'];
		if (!highlights) {
			console.error('❌ No highlights found.');
			return [];
		}
		const highlightData = highlights.find(h => h?.data?.highlights?.edges?.length && h.data.highlights.edges[0].user?.username == username)?.data.highlights.edges;
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
			//console.log(util.inspect(feeds, { depth: null, colors: true }));
			return null;
		}
		const highlightData = highlightFeed.data?.xdt_api__v1__feed__reels_media__connection?.edges.find(e => e.node?.id == highlightId);
		if (!highlightData) {
			console.error('❌ No highlight data found.');
			//console.log(util.inspect(highlightFeed, { depth: null, colors: true }));
			return null;
		}
		return highlightData.node;
	}

	// Same as the getHighlightData but checks node.username instead of node.id for the user stories
	getStoriesConnectionData(username) {
		const feeds = this._queryCache['xdt_api__v1__feed__reels_media__connection'];
		if (!feeds) {
			console.error('❌ No feeds found.');
			return null;
		}
		const storiesFeed = feeds.find(f => (f.data?.xdt_api__v1__feed__reels_media__connection?.edges || []).find(e => e.node?.username == username));
		if (!storiesFeed) {
			console.error(`❌ ${username} stories not found in feeds data.`);
			return null;
		}
		const storiesData = storiesFeed.data?.xdt_api__v1__feed__reels_media__connection?.edges.find(e => e.node?.username == username);
		if (!storiesData) {
			console.error('❌ No highlight data found.');
			return null;
		}
		return storiesData.node;
	}

	getStoriesData(username) {
		const feeds = this._queryCache['xdt_api__v1__feed__reels_media'];
		if (!feeds) {
			console.error('❌ No feeds found.');
			// Try using the reels_media_connection instead
			return this.getStoriesConnectionData(username);
		}
		const storiesFeed = feeds.find(f => (f.data?.xdt_api__v1__feed__reels_media?.reels_media || []).find(m => m.user?.username == username));
		if (!storiesFeed) {
			console.error(`❌ ${username} stories not found in feeds data.`);
			// Try using the reels_media_connection instead
			return this.getStoriesConnectionData(username);
		}
		const storiesData = storiesFeed.data?.xdt_api__v1__feed__reels_media?.reels_media.find(m => m.user?.username == username);
		if (!storiesData) {
			console.error('❌ No stories data found.');
			// Try using the reels_media_connection instead
			return this.getStoriesConnectionData(username);
		}
		return storiesData;
	}

	getMediaData(mediaCode) {
		const medias = this._queryCache['xdt_api__v1__media__shortcode__web_info'];
		if (!medias) {
			console.error('❌ No medias found.');
			return null;
		}
		const mediaItems = medias.find(r => (r.data?.xdt_api__v1__media__shortcode__web_info?.items || []).find(n => n.code == mediaCode));
		if (!mediaItems) {
			console.error(`❌ Media ${mediaCode} not found in medias web info.`);
			return null;
		}
		const mediaData = mediaItems.data?.xdt_api__v1__media__shortcode__web_info?.items.find(n => n.code == mediaCode);
		if (!mediaData) {
			console.error('❌ No media data found.');
			return null;
		}
		return mediaData;
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

	async archivePage(pageUrl, outputDir = this.options.output) {
		console.log(`📸 Archiving ${pageUrl}...`);
		let type = 'media';
		if (pageUrl.startsWith('@')) {
			pageUrl = pageUrl.slice(1);
		}
		if (pageUrl.startsWith('http')) {
			if (pageUrl.includes("/highlights/")) {
				type = 'highlight';
			} else if (pageUrl.match(/instagram\.com\/[^/]+\/?$/)) {
				type = 'profile';
			} else if (pageUrl.match(/instagram\.com\/stories\/[^/]+\/?$/)) {
				type = 'stories';
			}
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


		let retValue = 0;
		if (type === 'profile') {
			const username = pageUrl.split('/').filter(a => a).pop();
			console.log(`📸 Archiving profile of ${username}...`);
			await this.page.goto(pageUrl, { waitUntil: 'networkidle2' });
			await waitMS(2000, 1000); // Wait for 2 to 3 seconds to ensure the page is fully loaded
			const output = path.join(outputDir, sanitizeFilename(pageUrl.split('/').filter(a => a).pop()));
			await fs.mkdirs(output);
			const user = this.getUserData(username);
			await fs.writeFile(path.join(output, "profile.json"), JSON.stringify(user, null, 2));
			if (this.options.highlights) {
				const highlights = this.getHighlights(username);
				if (highlights) {
					console.log(`📸 Found ${highlights.length} highlights.`);
					console.log(highlights.map(h => h.title).join(', '));
					const highlightsOutput = path.join(output, 'highlights');
					await fs.mkdirs(highlightsOutput);
					await fs.writeFile(path.join(highlightsOutput, "highlights.json"), JSON.stringify(highlights, null, 2));
					for (const highlight of highlights) {
						const highlightId = highlight.id;
						console.log(`📸 Archiving highlight ${highlight.title} (${highlightId})...`);
						const highlightData = this.getHighlightData(highlightId);
						const highlightDir = path.join(highlightsOutput, sanitizeFilename(highlight.title));
						await fs.mkdirs(highlightDir);
						let downloaded = 0;
						if (!highlightData) {
							downloaded = await this.archivePage(highlight.url, highlightDir);
						} else {
							console.log(`📸 Highlight ${highlight.title} has ${highlightData.items?.length} items`);
							downloaded = await this.downloadStories(highlightData, highlightDir);
						}
						retValue += downloaded;
						if (this.options.update) {
							// If we're updating our archive, stop after the first highlight which had no new downloads
							if (downloaded === 0) {
								console.log(`⚠️ No new downloads for highlight ${highlight.title}. Stopping further downloads.`);
								break;
							}
						}
					}
				}
			}
			if (this.options.stories) {
				const storiesUrl = `https://www.instagram.com/stories/${username}/`;
				const storiesOutput = path.join(output, 'stories');
				await fs.mkdirs(storiesOutput);
				await this.archivePage(storiesUrl, storiesOutput);
			}
		} else if (type === 'media') {
			const mediaCode = pageUrl.split("/").filter(a => a).pop();
			await this.downloadMedia(mediaCode, outputDir);
		} else if (type === 'stories') {
			const username = pageUrl.split('/').filter(a => a).pop();
			console.log(`📸 Archiving stories of ${username}...`);
			await this.page.goto(pageUrl, { waitUntil: 'networkidle2' });
			await waitMS(2000, 1000); // Wait for 2 to 3 seconds to ensure the page is fully loaded
			const queryName = 'xdt_api__v1__feed__reels_media';
			const data = await this._findObjectFromPage(queryName);
			if (!data) {
				console.error('❌ No stories data found in page.');
				return;
			}
			await this._saveResponse({data: data}, queryName);
			let storiesData = this.getStoriesData(username);
			if (!storiesData) {
				console.error('❌ No stories data found in query cache.');
				storiesData = data?.xdt_api__v1__feed__reels_media?.reels_media[0];
			}
			retValue = await this.downloadStories(storiesData, outputDir);
		} else if (type === 'highlight') {
			await this.page.goto(pageUrl, { waitUntil: 'networkidle2' });
			await waitMS(2000, 1000); // Wait for 2 to 3 seconds to ensure the page is fully loaded
			const queryName = 'xdt_api__v1__feed__reels_media__connection';
			const data = await this._findObjectFromPage(queryName);
			if (!data) {
				console.error('❌ No highlight data found in page.');
				return;
			}
			await this._saveResponse({data: data}, queryName);
			const highlightId = pageUrl.split("/").filter(a => a).pop();
			let highlightData = this.getHighlightData(highlightId);
			if (!highlightData) {
				console.error('❌ No highlight data found in query cache.');
				highlightData = data?.xdt_api__v1__feed__reels_media__connection?.edges[0].node;
				//console.log(util.inspect(highlightData, { depth: null, colors: true }));
			}
			retValue = await this.downloadStories(highlightData, outputDir);
		}

		console.log(`📸 Finished archiving ${pageUrl}.`);
		return retValue;
	}

	async downloadStories(storiesData, outputDir = this.options.output) {
		const isHighlight = storiesData.title !== null;
		const filename = isHighlight ? "highlight" : "story";
		console.log(`📸 ${isHighlight ? `Highlight ${storiesData.title}` : `User ${storiesData.user.username}`} has ${storiesData.items?.length} stories`);
		await fs.writeFile(path.join(outputDir, `${filename}.json`), JSON.stringify(storiesData, null, 2));
		
		let downloaded = 0;
		for (const item of storiesData.items || []) {
			// Name the folder based on the taken_at field of the media data
			const date = new Date(item.taken_at * 1000 || Date.now());
			const itemDir = path.join(outputDir, formatDateForFilename(date));
			if (await fs.pathExists(itemDir)) {
				console.warn(`⚠️ Folder ${itemDir} already exists. Skipping download for this item.`);
				continue;
			}
			await fs.mkdirs(itemDir);
			await this._downloadMediaFromData(item, itemDir, {
				filename: item.video_versions ? `${filename}.mp4` : `${filename}.jpg`
			});
			if (item.story_feed_media && item.story_feed_media.length > 0) {
				for (const media of item.story_feed_media) {
					await this.downloadMedia(media.media_code, itemDir);
				}
			} else {
				console.warn(`⚠️ No media code found for item ${item.id}. Skipping download.`);
			}
			downloaded++;
		}
		return downloaded;
	}

	// Get the media data from the incognito page or using normal page if it fails to find the media in incognito
	// then create a folder in the output directory based on the media code
	// If the media is a carousel, download all the media items, otherwise download the single media item
	// Download the images or video depending on what is available, then save the caption to a caption.txt file
	// in the same folder
	async downloadMedia(mediaCode, outputDir = this.options.output) {
		const queryName = 'xdt_api__v1__media__shortcode__web_info';
		const incognitoPage = this.options.incognito ? await this._ensureIncognitoExists() : await this._ensurePageExists();
		
		// Check if the media data is already cached
		let mediaData = this.getMediaData(mediaCode);
		if (!mediaData) {
			await incognitoPage.goto(`https://www.instagram.com/p/${mediaCode}/`, { waitUntil: 'networkidle2' });
			let webInfo = await this._findObjectFromPage(queryName, { page: incognitoPage });
			if (!webInfo && this.options.incognito) {
				console.warn(`❌ No media data found for ${mediaCode} in incognito tab.`);
				// Might be a private post, try to fetch it from the normal page
				const page = await this._ensurePageExists();
				await page.goto(`https://www.instagram.com/p/${mediaCode}/`, { waitUntil: 'networkidle2' });
				webInfo = await this._findObjectFromPage(queryName, { page });
			}
			if (!webInfo) {
				console.error(`❌ No media data found for ${mediaCode}.`);
				return null;
			}
			await this._saveResponse({data: webInfo}, queryName);
			mediaData = webInfo?.xdt_api__v1__media__shortcode__web_info?.items[0];
		}
		if (!mediaData) {
			console.error(`❌ No media data found for ${mediaCode}.`);
			return null;
		}
		if (mediaData.code !== mediaCode) {
			console.error(`⚠️ Media code mismatch: expected ${mediaCode}, got ${mediaData.code}. Cancelling download.`);
			return null;
		}
		await fs.writeFile(path.join(outputDir, "media.json"), JSON.stringify(mediaData, null, 2));
		await fs.writeFile(path.join(outputDir, "caption.txt"), mediaData.caption?.text || '');
		console.log(`📸 Downloading media ${mediaCode} to ${outputDir}...`);
		await this._downloadMediaFromData(mediaData, outputDir, { page: incognitoPage});
	}

	// Download media items from the media data object
	async _downloadMediaFromData(mediaData, outputFolder, { filename, page } = {}) {
		if (!mediaData || !outputFolder) {
			console.error('❌ Invalid media data or output folder.');
			return;
		}

		const mediaItems = mediaData.carousel_media || [mediaData];
		let idx = 1;
		for (const item of mediaItems) {
			const mediaUrl = item.video_versions?.[0]?.url || item.image_versions2?.candidates?.[0]?.url;
			if (!mediaUrl) {
				console.warn(`❌ No media URL found for item ${item.code}. Skipping...`);
				continue;
			}
			await this._downloadMedia(mediaUrl, outputFolder, {
				filename,
				prefix: mediaItems.length > 1 ? `${String(idx++).padStart(2, '0')} - ` : undefined,
				page: page || this.page
			});
		}

	}
	
	/**
	 * Downloads a URL to a file in the given folder using the best possible filename.
	 * @param {string} url - The URL to download.
	 * @param {string} folder - The folder path to save the file in.
	 */
	async _downloadMedia(url, folder, { filename, prefix, page } = {}) {
		try {
			let headers;
			if (page) {
				// Get cookies from Puppeteer and build cookie header
				const cookies = await page.cookies(url);
				const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

				// Get the user-agent from the Puppeteer page
				const userAgent = await page.evaluate(() => navigator.userAgent);

				// Optional: get other headers (e.g., referer)
				const referer = page.url();

				// Build headers
				headers = {
					'User-Agent': userAgent,
					'Cookie': cookieHeader,
					'Referer': referer,
					'Accept': '*/*',
				};
			}
			const response = await fetch(url, { headers});

			if (!response.ok) {
				throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
			}

			if (!filename) {
				// Try to get filename from Content-Disposition header
				const contentDisp = response.headers.get('content-disposition');
				if (contentDisp) {
					try {
						const parsed = contentDisposition.parse(contentDisp);
						if (parsed.parameters.filename) {
							filename = parsed.parameters.filename;
						}
					} catch (err) {
						console.warn(`Could not parse Content-Disposition: ${err.message}`);
					}
				}

				// Fallback: use the last part of the URL path
				if (!filename) {
					const urlPath = new URL(url).pathname;
					filename = path.basename(urlPath) || 'downloaded-file';
				}
			}
			if (prefix) {
				filename = `${prefix}${filename}`;
			}
			const fullPath = path.join(folder, filename);
			const fileStream = fs.createWriteStream(fullPath);

			await streamPipeline(response.body, fileStream);
			console.log(`✅ Downloaded to ${fullPath}`);
		} catch (err) {
			console.error(`❌ Download failed: ${err.message}`);
		}
	}

	async logout() {
		console.log('🔒 Logging out of Instagram...');
		await this.page.goto('https://www.instagram.com/accounts/logout/', { waitUntil: 'networkidle2' });
		await waitMS(2000) // Wait for logout to complete
		console.log('🔒 Successfully logged out.')
		await this.page.close();
	}
}
