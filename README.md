# Archive Instagram pages and accounts

Instarchiver is a tool to archive Instagram accounts, it can download Instagram posts and all highlights from a user's account.

This is the safest method to avoid getting your account suspended as it uses a chromium browser to navigate Instagram and emulate a real user. While this should be safer than other tools which use Instagram's API directly, there are no guarantees and Instagram could always detect suspicious activity and suspend your account.

Run the script with `--user-data ./user-data` to store the browser's user data, which allows it to keep track of cookies and local storage, etc...
Once prompted to enter the username/password to login to instagram, you can do so, or you can launch with `--no-headless` and login manually through the instagram page itself (if the terminal is unsafe), and restart the script (as long as `--user-data` is provided, you will remain logged in).

Specify an instagram account to archive and the `--output` folder to make a backup of that content.

Run it with `--help` for the available command line options:
```
$ node src/index.js --help
Usage: node index.js [options] [@username,highglight:id,url...]
Options:
  --output                 Output directory for saved content
  --user-data              User data directory (required to save cookies)
  --update                 Update an existing archive
  --incognito              Use incognito mode for downloading public media reels
  --no-headless            Run browser in non-headless mode
  --logout                 logout when done
  --help, -h               Show this help message
  --debug                  Enable debug mode
```

You can use the `--update` option to have the tool stop once it finds a post or highlight that has already been archives, thus avoiding more requests to Instagram than necessary.

## Disclaimer
instarchiver is in no way affiliated with, authorized, maintained or endorsed by Instagram or any of its affiliates or subsidiaries. This is an independent and unofficial project. Use at your own risk.

instarchiver is licensed under an MIT license. Refer to LICENSE file for more information.