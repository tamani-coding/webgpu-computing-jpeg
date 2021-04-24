import { decode, encode, RawImageData, BufferLike } from 'jpeg-js'
import * as buffer from 'buffer';
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

// OUTPUT IMAGE
const outputImage = document.createElement('img')
document.body.appendChild(outputImage)

function imageSelected(event: Event) {
    const files = this.files;

    if (!files || files.length < 1) {
        return;
    }
    console.log(files[0].type);
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

        arrayReader.result as ArrayBuffer

        const d = decode(arrayReader.result as ArrayBuffer);
        console.log(d.data);
    
        processImage(d.data, d.width, d.height).then(result => {
    
            const resultImage: RawImageData<BufferLike> = {
                width: d.width,
                height: d.height,
                data: result
            }
    
            encode(resultImage)
        })
    }, false);
    arrayReader.readAsArrayBuffer(files[0])
}

async function device() {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
        console.log('NO WEBGPU FOUND')
        return;
    }
    return await adapter.requestDevice();
}

function processImage(array: Uint8Array, width: number, height: number): Promise<Uint8Array> {
    return new Promise(
        resolve => {
            device().then((device: GPUDevice | null | undefined) => {
                if (!device) {
                    console.log('NO GPU DEVICE');
                    return;
                }

                const [pad, inputArray] = padArray(array);
                // INPUT BUFFER
                // Get a GPU buffer in a mapped state and an arrayBuffer for writing.
                const gpuInputBuffer = device.createBuffer({
                    mappedAtCreation: true,
                    size: inputArray.length,
                    usage: GPUBufferUsage.STORAGE
                });
                const arrayBuffer = gpuInputBuffer.getMappedRange();
                // Write bytes to buffer.
                new Uint8Array(arrayBuffer).set(inputArray);
                // Unmap buffer so that it can be used later for copy.
                gpuInputBuffer.unmap();

                // OUTPUT BUFFER
                // Get a GPU buffer for reading in an unmapped state.
                const gpuResultBuffer = device.createBuffer({
                    size: inputArray.length,
                    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
                });

                //BIND GROUP LAYOUT
                const bindGroupLayout = device.createBindGroupLayout({
                    entries: [
                        {
                            binding: 0,
                            visibility: GPUShaderStage.COMPUTE,
                            buffer: {
                                type: "read-only-storage"
                            }
                        } as GPUBindGroupLayoutEntry,
                        {
                            binding: 1,
                            visibility: GPUShaderStage.COMPUTE,
                            buffer: {
                                type: "storage"
                            }
                        } as GPUBindGroupLayoutEntry
                    ]
                });

                const bindGroup = device.createBindGroup({
                    layout: bindGroupLayout,
                    entries: [
                        {
                            binding: 0,
                            resource: {
                                buffer: gpuInputBuffer
                            }
                        },
                        {
                            binding: 1,
                            resource: {
                                buffer: gpuResultBuffer
                            }
                        }
                    ]
                });

                const shaderModule = device.createShaderModule({
                    code: shader
                });

                const computePipeline = device.createComputePipeline({
                    layout: device.createPipelineLayout({
                        bindGroupLayouts: [bindGroupLayout]
                    }),
                    compute: {
                        module: shaderModule,
                        entryPoint: "main"
                    }
                });

                // Encode commands for copying buffer to buffer.
                const commandEncoder = device.createCommandEncoder();
                const passEncoder = commandEncoder.beginComputePass();
                passEncoder.setPipeline(computePipeline);
                passEncoder.setBindGroup(0, bindGroup);
                passEncoder.dispatch(width, height);
                passEncoder.endPass();

                // Get a GPU buffer for reading in an unmapped state.
                const gpuReadBuffer = device.createBuffer({
                    size: inputArray.length,
                    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
                });

                // Encode commands for copying buffer to buffer.
                commandEncoder.copyBufferToBuffer(
                    gpuResultBuffer /* source buffer */,
                    0 /* source offset */,
                    gpuReadBuffer /* destination buffer */,
                    0 /* destination offset */,
                    inputArray.length /* size */
                );

                const copyCommands = commandEncoder.finish();
                device.queue.submit([copyCommands]);


                // Read buffer.
                gpuReadBuffer.mapAsync(GPUMapMode.READ).then(() => {
                    const copyArrayBuffer = gpuReadBuffer.getMappedRange();
                    console.log(new Uint8Array(copyArrayBuffer))


                    if (pad != 4) {
                        resolve(new Uint8Array(copyArrayBuffer.slice(0, copyArrayBuffer.byteLength - pad)))
                    } else {
                        resolve(new Uint8Array(copyArrayBuffer))
                    }
                });

            })
        }
    );
}

function padArray(array: ArrayBuffer): [number, number[]] {
    const inputArray = Array.from(new Uint8Array(array))
    console.log('org. length ' + inputArray.length)

    const pad = 4 - (inputArray.length % 4);
    if (pad != 4) { // must be multiple of 4
        console.log('modulo ' + pad)
        for (let i = 0; i < pad; i++) {
            inputArray.push(0)
        }
    }
    console.log('new length ' + inputArray.length)

    return [pad, inputArray];
}

const shader = `
[[block]] struct Matrix {
  rgba: array<u32>;
};

[[group(0), binding(0)]] var<storage> inputPixels : [[access(read)]] Matrix;
[[group(0), binding(1)]] var<storage> outputPixels : [[access(write)]] Matrix;

[[builtin(local_invocation_id)]]
var<in> local_id : vec3<u32>;
[[builtin(local_invocation_index)]] 
var<in> local_index : u32;
[[builtin(global_invocation_id)]] 
var<in> global_id : vec3<u32>;

[[stage(compute)]]
fn main() {
    outputPixels.rgba[global_id.x + global_id.y] = inputPixels.rgba[global_id.x + global_id.y];
}
`