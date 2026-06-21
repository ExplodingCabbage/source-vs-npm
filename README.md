# source-vs-npm

Tools to check that npm package contents match what you get when you build them from source.

Summary of this repo's contents:

TODO: Add summary
TODO: Add Postgres installation instructions
TODO: Add usage instructions

### Production server

The public website at https://sourcevsnpm.com is hosted on a single AWS EC2 instance with an elastic IP. Its Postgres database runs on the same instance (and accessible over the internet, e.g. from my local machine, with a password) and the webserver connects to it locally via peer auth. Code changes are done by me SSHing into the EC2 instance and running `git pull origin` and `npm install` from the `source-vs-npm` folder, then restarting the webserver with `sudo service express restart`. SSL certificates are requisitioned using certbot. Node, Postgres, certbot, and authbind were all installed and configured by hand and there is no reusable setup script. The systemd service is based on https://expressjs.com/en/advanced/best-practice-performance/#systemd.
