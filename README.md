Archive Instagram pages and accounts

This is the safest method to avoid getting your account suspended as it uses a chromium browser to navigate Instagram and emulate a real user. However, there are no guarantees and Instagram could always detect suspicious activity and suspend your account.

Run the script with `--user-data ./user-data` to store the browser's user data, which allows it to keep track of cookies and local storage, etc...
Once prompted to enter the username/password to login to instagram, you can do so, or you can launch with `--no-headless` and login manually through the instagram page itself, and restart the script (as long as `--user-data` is provided, you will remain logged in).

Specify an instagram account to archive and the `--output` to make a backup of that content.