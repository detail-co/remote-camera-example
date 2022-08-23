# Remote-camera-example

This repo is essentially [this example repo from AWS](https://github.com/awslabs/amazon-kinesis-video-streams-webrtc-sdk-js), but running on Node (Express server) and simplified a bit to prevent secrets from making their way into the frontend code.

1. Make sure to update your settings in `index.js` L28-41
2. Update your AWS region in `public/viewer.js` L25, and again in `public/master.js` L40
3. Install dependencies with `npm i`
4. Run the code with `node index.js`
5. Check out localhost:3003