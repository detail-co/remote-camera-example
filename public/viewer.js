/**
 * This file demonstrates the process of starting WebRTC streaming using a KVS Signaling Channel.
 */
const viewer = {};

async function startViewer(localView, remoteView, onStatsReport, onRemoteDataMessage) {
    viewer.localView = localView;
    viewer.remoteView = remoteView;

    const response = await fetch('/getConfig?clientId=VIEWER');
    const resp = await response.json();

    let channelARN = resp.channelARN;
    let wss = resp.wss;
    let configuration = resp.configuration;
    let url = resp.url;
    let clientId = resp.clientId;

    // Create Signaling Client
    viewer.signalingClient = new KVSWebRTC.SignalingClient({
        channelARN,
        channelEndpoint: wss,
        clientId: clientId,
        role: 'VIEWER',
        region: 'REGION',
        requestSigner: new CustomSigner(url),
        systemClockOffset: true,
    });

    const resolution = { width: { ideal: 1280 }, height: { ideal: 720 } };
    const constraints = {
        video: resolution,
        audio: true,
    };

    viewer.peerConnection = new RTCPeerConnection(configuration);
    viewer.dataChannel = viewer.peerConnection.createDataChannel('kvsDataChannel');
    viewer.peerConnection.ondatachannel = event => {
        event.channel.onmessage = onRemoteDataMessage;
    };

    // Poll for connection stats
    viewer.peerConnectionStatsInterval = setInterval(() => viewer.peerConnection.getStats().then(onStatsReport), 1000);

    viewer.signalingClient.on('open', async () => {
        console.log('[VIEWER] Connected to signaling service');

        // Get a stream from the webcam, add it to the peer connection, and display it in the local view.
        // If no video/audio needed, no need to request for the sources. 
        // Otherwise, the browser will throw an error saying that either video or audio has to be enabled.
        try {
            viewer.localStream = await navigator.mediaDevices.getUserMedia(constraints);
            viewer.localStream.getTracks().forEach(track => viewer.peerConnection.addTrack(track, viewer.localStream));
            localView.srcObject = viewer.localStream;
        } catch (e) {
            console.error('[VIEWER] Could not find webcam');
            return;
        }

        // Create an SDP offer to send to the master
        console.log('[VIEWER] Creating SDP offer');
        await viewer.peerConnection.setLocalDescription(
            await viewer.peerConnection.createOffer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: true,
            }),
        );

        // When trickle ICE is enabled, send the offer now and then send ICE candidates as they are generated. Otherwise wait on the ICE candidates.
        console.log('[VIEWER] Sending SDP offer');
        viewer.signalingClient.sendSdpOffer(viewer.peerConnection.localDescription);
        console.log('[VIEWER] Generating ICE candidates');
    });

    viewer.signalingClient.on('sdpAnswer', async answer => {
        // Add the SDP answer to the peer connection
        console.log('[VIEWER] Received SDP answer');
        await viewer.peerConnection.setRemoteDescription(answer);
    });

    viewer.signalingClient.on('iceCandidate', candidate => {
        // Add the ICE candidate received from the MASTER to the peer connection
        console.log('[VIEWER] Received ICE candidate');
        viewer.peerConnection.addIceCandidate(candidate);
    });

    viewer.signalingClient.on('close', () => {
        console.log('[VIEWER] Disconnected from signaling channel');
    });

    viewer.signalingClient.on('error', error => {
        console.error('[VIEWER] Signaling client error: ', error);
    });

    // Send any ICE candidates to the other peer
    viewer.peerConnection.addEventListener('icecandidate', ({ candidate }) => {
        if (candidate) {
            console.log('[VIEWER] Generated ICE candidate');

            // When trickle ICE is enabled, send the ICE candidates as they are generated.
            console.log('[VIEWER] Sending ICE candidate');
            viewer.signalingClient.sendIceCandidate(candidate);
        } else {
            console.log('[VIEWER] All ICE candidates have been generated');
        }
    });

    // As remote tracks are received, add them to the remote view
    viewer.peerConnection.addEventListener('track', event => {
        console.log('[VIEWER] Received remote track');
        if (remoteView.srcObject) {
            return;
        }
        viewer.remoteStream = event.streams[0];
        remoteView.srcObject = viewer.remoteStream;
    });

    console.log('[VIEWER] Starting viewer connection');
    viewer.signalingClient.open();
}

function stopViewer() {
    console.log('[VIEWER] Stopping viewer connection');
    if (viewer.signalingClient) {
        viewer.signalingClient.close();
        viewer.signalingClient = null;
    }

    if (viewer.peerConnection) {
        viewer.peerConnection.close();
        viewer.peerConnection = null;
    }

    if (viewer.localStream) {
        viewer.localStream.getTracks().forEach(track => track.stop());
        viewer.localStream = null;
    }

    if (viewer.remoteStream) {
        viewer.remoteStream.getTracks().forEach(track => track.stop());
        viewer.remoteStream = null;
    }

    if (viewer.peerConnectionStatsInterval) {
        clearInterval(viewer.peerConnectionStatsInterval);
        viewer.peerConnectionStatsInterval = null;
    }

    if (viewer.localView) {
        viewer.localView.srcObject = null;
    }

    if (viewer.remoteView) {
        viewer.remoteView.srcObject = null;
    }

    if (viewer.dataChannel) {
        viewer.dataChannel = null;
    }
}