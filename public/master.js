/**
 * This file demonstrates the process of starting WebRTC streaming using a KVS Signaling Channel.
 */
const master = {
    signalingClient: null,
    peerConnectionByClientId: {},
    dataChannelByClientId: {},
    localStream: null,
    remoteStreams: [],
    peerConnectionStatsInterval: null,
};

class CustomSigner {
    constructor (_url) {
      this.url = _url;
    }
  
    getSignedURL () {
      return this.url;
    }
  }

async function startMaster(localView, remoteView, onStatsReport, onRemoteDataMessage) {
    master.localView = localView;
    master.remoteView = remoteView;

    const response = await fetch('/getConfig?clientId=MASTER');
    const resp = await response.json();

    let channelARN = resp.channelARN;
    let wss = resp.wss;
    let configuration = resp.configuration;
    let url = resp.url;

    // Create Signaling Client
    master.signalingClient = new KVSWebRTC.SignalingClient({
        channelARN,
        channelEndpoint: wss,
        role: 'MASTER',
        region: 'REGION',
        requestSigner: new CustomSigner(url),
        systemClockOffset: true,
    });

    const resolution = { width: { ideal: 1280 }, height: { ideal: 720 } };
    const constraints = {
        video: resolution,
        audio: true,
    };

    // Get a stream from the webcam and display it in the local view. 
    // If no video/audio needed, no need to request for the sources. 
    // Otherwise, the browser will throw an error saying that either video or audio has to be enabled.
    try {
        master.localStream = await navigator.mediaDevices.getUserMedia(constraints);
        localView.srcObject = master.localStream;
    } catch (e) {
        console.error('[MASTER] Could not find webcam');
    }

    master.signalingClient.on('open', async () => {
        console.log('[MASTER] Connected to signaling service');
    });

    master.signalingClient.on('sdpOffer', async (offer, remoteClientId) => {
        console.log('[MASTER] Received SDP offer from client: ' + remoteClientId);

        // Create a new peer connection using the offer from the given client
        const peerConnection = new RTCPeerConnection(configuration);
        master.peerConnectionByClientId[remoteClientId] = peerConnection;

        master.dataChannelByClientId[remoteClientId] = peerConnection.createDataChannel('kvsDataChannel');
        peerConnection.ondatachannel = event => {
            event.channel.onmessage = onRemoteDataMessage;
        };

        // Poll for connection stats
        if (!master.peerConnectionStatsInterval) {
            master.peerConnectionStatsInterval = setInterval(() => peerConnection.getStats().then(onStatsReport), 1000);
        }

        // Send any ICE candidates to the other peer
        peerConnection.addEventListener('icecandidate', ({ candidate }) => {
            if (candidate) {
                console.log('[MASTER] Generated ICE candidate for client: ' + remoteClientId);

                // When trickle ICE is enabled, send the ICE candidates as they are generated.
                console.log('[MASTER] Sending ICE candidate to client: ' + remoteClientId);
                master.signalingClient.sendIceCandidate(candidate, remoteClientId);
            } else {
                console.log('[MASTER] All ICE candidates have been generated for client: ' + remoteClientId);
            }
        });

        // As remote tracks are received, add them to the remote view
        peerConnection.addEventListener('track', event => {
            console.log('[MASTER] Received remote track from client: ' + remoteClientId);
            if (remoteView.srcObject) {
                return;
            }
            remoteView.srcObject = event.streams[0];
        });

        // If there's no video/audio, master.localStream will be null. So, we should skip adding the tracks from it.
        if (master.localStream) {
            master.localStream.getTracks().forEach(track => peerConnection.addTrack(track, master.localStream));
        }
        await peerConnection.setRemoteDescription(offer);

        // Create an SDP answer to send back to the client
        console.log('[MASTER] Creating SDP answer for client: ' + remoteClientId);
        await peerConnection.setLocalDescription(
            await peerConnection.createAnswer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: true,
            }),
        );

        // When trickle ICE is enabled, send the answer now and then send ICE candidates as they are generated. Otherwise wait on the ICE candidates.
        console.log('[MASTER] Sending SDP answer to client: ' + remoteClientId);
        master.signalingClient.sendSdpAnswer(peerConnection.localDescription, remoteClientId);
        console.log('[MASTER] Generating ICE candidates for client: ' + remoteClientId);
    });

    master.signalingClient.on('iceCandidate', async (candidate, remoteClientId) => {
        console.log('[MASTER] Received ICE candidate from client: ' + remoteClientId);

        // Add the ICE candidate received from the client to the peer connection
        const peerConnection = master.peerConnectionByClientId[remoteClientId];
        peerConnection.addIceCandidate(candidate);
    });

    master.signalingClient.on('close', () => {
        console.log('[MASTER] Disconnected from signaling channel');
    });

    master.signalingClient.on('error', () => {
        console.error('[MASTER] Signaling client error');
    });

    console.log('[MASTER] Starting master connection');
    master.signalingClient.open();
}

function stopMaster() {
    console.log('[MASTER] Stopping master connection');
    if (master.signalingClient) {
        master.signalingClient.close();
        master.signalingClient = null;
    }

    Object.keys(master.peerConnectionByClientId).forEach(clientId => {
        master.peerConnectionByClientId[clientId].close();
    });
    master.peerConnectionByClientId = [];

    if (master.localStream) {
        master.localStream.getTracks().forEach(track => track.stop());
        master.localStream = null;
    }

    master.remoteStreams.forEach(remoteStream => remoteStream.getTracks().forEach(track => track.stop()));
    master.remoteStreams = [];

    if (master.peerConnectionStatsInterval) {
        clearInterval(master.peerConnectionStatsInterval);
        master.peerConnectionStatsInterval = null;
    }

    if (master.localView) {
        master.localView.srcObject = null;
    }

    if (master.remoteView) {
        master.remoteView.srcObject = null;
    }

    if (master.dataChannelByClientId) {
        master.dataChannelByClientId = {};
    }
}