const express = require('express');
const AWS = require('aws-sdk');
const { json, urlencoded } = express;
const app = express();
const SigV4RequestSigner = require('amazon-kinesis-video-streams-webrtc').SigV4RequestSigner;

app.use(express.static('public'))
app.set('views', __dirname + '/public/views');
app.engine('html', require('ejs').renderFile);
app.set('view engine', 'html');

app.use(json());
app.use(urlencoded({ extended: true }));

function getRandomClientId() {
  return Math.random()
    .toString(36)
    .substring(2)
    .toUpperCase();
}

app.get('/', async (req, res) => {
  // render the page
  res.render('main.html');
});

app.get('/getConfig', async (req, res) => {
  const region = 'REGION';
  const channelName = 'MY-TEST-CHANNEL-NAME';

  // make sure to put these two values somewhere safe (i.e. Secrets Manager)
  // these are the permissions required for this user
  //
  //                 "kinesisvideo:ConnectAsViewer",
  //                 "kinesisvideo:ConnectAsMaster",
  //                 "kinesisvideo:DescribeSignalingChannel",
  //                 "kinesisvideo:GetIceServerConfig",
  //                 "kinesisvideo:GetSignalingChannelEndpoint"

  const signerAccessKeyId = 'ACCESS-KEY-ID';
  const signerSecretKey = 'SECRET-KEY';

  let clientId = req.query.clientId;

  // Assumes the right permissions are already granted in your environment
  // If it's not the case, you can pass in an accessKeyId and secretAccessKey here
  const kinesisVideoClient = new AWS.KinesisVideo({
    region: region,
    endpoint: null,
    correctClockSkew: true,
  });

  // Get signaling channel ARN
  const describeSignalingChannelResponse = await kinesisVideoClient
    .describeSignalingChannel({
      ChannelName: channelName,
    })
    .promise();
  const channelARN = describeSignalingChannelResponse.ChannelInfo.ChannelARN;
  console.log(`[clientId] Channel ARN: `, channelARN);

  // Get signaling channel endpoints
  const getSignalingChannelEndpointResponse = await kinesisVideoClient
    .getSignalingChannelEndpoint({
      ChannelARN: channelARN,
      SingleMasterChannelEndpointConfiguration: {
        Protocols: ['WSS', 'HTTPS'],
        Role: clientId,
      },
    })
    .promise();
  const endpointsByProtocol = getSignalingChannelEndpointResponse.ResourceEndpointList.reduce((endpoints, endpoint) => {
    endpoints[endpoint.Protocol] = endpoint.ResourceEndpoint;
    return endpoints;
  }, {});

  const wss = endpointsByProtocol.WSS;

  // Get ICE server configuration
  const kinesisVideoSignalingChannelsClient = new AWS.KinesisVideoSignalingChannels({
    region: region,
    endpoint: endpointsByProtocol.HTTPS,
    correctClockSkew: true,
  });
  const getIceServerConfigResponse = await kinesisVideoSignalingChannelsClient
    .getIceServerConfig({
      ChannelARN: channelARN,
    })
    .promise();
  const iceServers = [];
  iceServers.push({ urls: `stun:stun.kinesisvideo.${region}.amazonaws.com:443` });

  getIceServerConfigResponse.IceServerList.forEach(iceServer =>
    iceServers.push({
      urls: iceServer.Uris,
      username: iceServer.Username,
      credential: iceServer.Password,
    }),
  );

  console.log('[MASTER] ICE servers: ', iceServers);

  const configuration = {
    iceServers,
    iceTransportPolicy: 'all',
  };

  console.log('[MASTER] Endpoints: ', endpointsByProtocol);

  if (clientId === 'MASTER') {
    clientId = 'MASTER_ID';
  } else {
    clientId = getRandomClientId();
  }

  // signature stuff
  let queryParams = {
    'X-Amz-ChannelARN': channelARN,
    'X-Amz-ClientId': clientId
  };
  let credential = {
    region: region,
    accessKeyId: signerAccessKeyId,
    secretAccessKey: signerSecretKey,
  };

  const signer = new SigV4RequestSigner(region, credential);
  const url = await signer.getSignedURL(wss, queryParams);

  return res.json({ channelARN, wss, configuration, url, clientId })

})

app.listen(3003, () => {
  console.log(`app running on port: 3003`);
});