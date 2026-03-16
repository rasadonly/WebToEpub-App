# Deploying Your Own CORS Proxy

To avoid usage limits and ensure 24/7 reliability for WebToEpub, we recommend hosting your own private instance of `cors-anywhere`.

## 1. Get the Code
1.  Go to [Rob--W/cors-anywhere](https://github.com/Rob--W/cors-anywhere).
2.  Click **Fork** to create a copy in your own GitHub account.

## 2. Deploy to Render (Our Recommended Method)
1.  Create a free account at [Render.com](https://render.com/).
2.  Click the **New +** button and select **Web Service**.
3.  Connect your GitHub account and select your forked `cors-anywhere` repository.
4.  Configure the service:
    - **Name:** `my-webtoepub-proxy` (or anything you like)
    - **Environment:** `Node`
    - **Build Command:** `npm install`
    - **Start Command:** `node server.js`
5.  Click **Deploy Web Service**.

## 3. Link to WebToEpub
Once the deployment is complete, Render will give you a URL (e.g., `https://my-proxy.onrender.com/`).

1.  Open your **WebToEpub** app in your browser.
2.  Click **Settings** (Gear icon) if settings aren't visible.
3.  Scroll to **CORS Proxy**.
4.  Paste your new URL into the input field. **Important:** Ensure it ends with a forward slash `/`.
5.  Check the **Enable** box.

Your app is now using your own private server! No more "Usage Limited" errors.
