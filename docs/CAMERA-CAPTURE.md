# Direct camera sequence

On the upload screen choose **Kamera öffnen · mehrere Fotos aufnehmen**, allow camera access, take successive photos with **Foto aufnehmen**, then choose **Fertig · Kamera schließen**. There is no native photo-picker confirmation between shots. Existing photo selection remains available.

The same-origin browser camera uses getUserMedia (rear-facing preferred, no microphone) and a playsInline video preview. Each shutter press encodes the full video frame as JPEG and reuses the existing image intake and IndexedDB storage. It does not sort, analyze, publish, or initiate cross-device transfer. Camera frames have the resolution supplied by the browser's video stream, which can be lower than the iPhone Camera app's still photos; the existing file picker remains suitable for those originals.

The camera only starts on an explicit click. Tracks stop on Finish, component unmount, pagehide, and backgrounding. Late permission results are discarded and their tracks stopped after cancellation. The shutter is locked during encoding and persistent import, and respects the remaining batch limit. Permission errors explain the existing photo-picker fallback. Permissions-Policy allows only same-origin camera access; microphone/geolocation remain disabled.

Browser verification uses a simulated camera, including three consecutive captures, original blobs and persistence after reload, denied permission fallback, and stopping tracks when leaving the upload step. Physical iPhone Safari permission and camera quality still need a real-device check.
