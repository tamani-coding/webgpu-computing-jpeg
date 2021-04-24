import { decode, encode, RawImageData, BufferLike } from 'jpeg-js'
import * as buffer from 'buffer';
import { processImage } from './compute'
(window as any).Buffer = buffer.Buffer;

// FILE INPUT
const input = document.createElement('input')
input.type = 'file'
input.accept = 'image/jpeg';
input.addEventListener("change", imageSelected, false);
document.body.appendChild(input)

document.body.appendChild(document.createElement('br'))

// INPUT IMAGE
const inputImage = document.createElement('img')
document.body.appendChild(inputImage)

document.body.appendChild(document.createElement('br'))

// OUTPUT IMAGE
const outputImage = document.createElement('img')
document.body.appendChild(outputImage)

function imageSelected(event: Event) {
    const files = this.files;

    if (!files || files.length < 1) {
        return;
    }
    if (files[0].type != 'image/jpeg') {
        console.log('selected file is not an image!')
        return;
    }

    const dataUrlReader = new FileReader();
    dataUrlReader.addEventListener("load", function () {
        // convert image file to base64 string
        inputImage.src = dataUrlReader.result as string
    }, false);
    dataUrlReader.readAsDataURL(files[0])

    const arrayReader = new FileReader();
    arrayReader.addEventListener("load", function () {
        const d = decode(arrayReader.result as ArrayBuffer);
    
        processImage(new Uint32Array(d.data), d.width, d.height).then( result => {
            const resultImage: RawImageData<BufferLike> = {
                width: d.width,
                height: d.height,
                data: result
            }
            const encoded = encode(resultImage, 100)

            let binary = '';
            var bytes = new Uint8Array( encoded.data );
            var len = bytes.byteLength;
            for (var i = 0; i < len; i++) {
                binary += String.fromCharCode( bytes[ i ] );
            }

            let processed = 'data:' + files[0].type + ';base64,'
            processed += window.btoa(binary);

            outputImage.src = processed
        })
    }, false);
    arrayReader.readAsArrayBuffer(files[0])
}