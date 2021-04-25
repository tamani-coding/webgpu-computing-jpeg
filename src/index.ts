import { decode, encode, RawImageData, BufferLike } from 'jpeg-js'
import * as buffer from 'buffer';
import { processImage } from './compute'
(window as any).Buffer = buffer.Buffer;

document.getElementById('fileinput').onchange = imageSelected

function imageSelected(event: Event) {
    const files = this.files;

    if (!files || files.length < 1) {
        return;
    }
    if (files[0].type != 'image/jpeg') {
        console.log('selected file is not an image!')
        return;
    }

    // DISPLAY IMAGE
    const dataUrlReader = new FileReader();
    dataUrlReader.addEventListener("load", function () {
        (document.getElementById('inputimage') as HTMLImageElement).src = dataUrlReader.result as string
    }, false);
    dataUrlReader.readAsDataURL(files[0])

    // PROCESS IMAGE
    const arrayReader = new FileReader();
    arrayReader.addEventListener("load", function () {
        const d = decode(arrayReader.result as ArrayBuffer);

        const t0 = performance.now();
        processImage(new Uint8Array(d.data), d.width, d.height).then(result => {
            console.log('Elapsed time ' + (performance.now() - t0));

            const resultImage: RawImageData<BufferLike> = {
                width: d.width,
                height: d.height,
                data: result
            }
            const encoded = encode(resultImage, 100)

            let binary = '';
            var bytes = new Uint8Array(encoded.data);
            var len = bytes.byteLength;
            for (var i = 0; i < len; i++) {
                binary += String.fromCharCode(bytes[i]);
            }

            let processed = 'data:' + files[0].type + ';base64,'
            processed += window.btoa(binary);

            (document.getElementById('outputimage') as HTMLImageElement).src = processed
        })
    }, false);
    arrayReader.readAsArrayBuffer(files[0])
}