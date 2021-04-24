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
    
        processImage(d.data, d.width, d.height).then(result => {
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

                // WIDTH/HEIGHT BUFFER

                const sizeArray = new Float32Array([ width, height ]);
                const gpuWidthHeightBuffer = device.createBuffer({
                    mappedAtCreation: true,
                    size: sizeArray.byteLength,
                    usage: GPUBufferUsage.STORAGE
                });
                const arrayWidthHeightBuffer = gpuWidthHeightBuffer.getMappedRange(); 
                new Float32Array(arrayWidthHeightBuffer).set(sizeArray);
                gpuWidthHeightBuffer.unmap();

                // INPUT BUFFER
                // Get a GPU buffer in a mapped state and an arrayBuffer for writing.
                const gpuInputBuffer = device.createBuffer({
                    mappedAtCreation: true,
                    size: array.length,
                    usage: GPUBufferUsage.STORAGE
                });
                const arrayBuffer = gpuInputBuffer.getMappedRange();
                // Write bytes to buffer.
                new Uint8Array(arrayBuffer).set(array);
                // Unmap buffer so that it can be used later for copy.
                gpuInputBuffer.unmap();

                // OUTPUT BUFFER
                // Get a GPU buffer for reading in an unmapped state.
                const gpuResultBuffer = device.createBuffer({
                    size: array.length,
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
                                type: "read-only-storage"
                            }
                        } as GPUBindGroupLayoutEntry,
                        {
                            binding: 2,
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
                                buffer: gpuWidthHeightBuffer
                            }
                        },
                        {
                            binding: 1,
                            resource: {
                                buffer: gpuInputBuffer
                            }
                        },
                        {
                            binding: 2,
                            resource: {
                                buffer: gpuResultBuffer
                            }
                        }
                    ]
                });

                const shaderModule = device.createShaderModule({
                    code: shader_copy
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
                    size: array.length,
                    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
                });

                // Encode commands for copying buffer to buffer.
                commandEncoder.copyBufferToBuffer(
                    gpuResultBuffer /* source buffer */,
                    0 /* source offset */,
                    gpuReadBuffer /* destination buffer */,
                    0 /* destination offset */,
                    array.length /* size */
                );

                const copyCommands = commandEncoder.finish();
                device.queue.submit([copyCommands]);


                // Read buffer.
                gpuReadBuffer.mapAsync(GPUMapMode.READ).then(() => {
                    const copyArrayBuffer = gpuReadBuffer.getMappedRange();
                    // console.log('RESULT ' + new Uint8Array(copyArrayBuffer))
                    resolve(new Uint8Array(copyArrayBuffer))
                });

            })
        }
    );
}

const shader = `
[[block]] struct Size {
    size: vec2<f32>;
};

[[block]] struct Image {
  rgba: array<u32>;
};

[[group(0), binding(0)]] var<storage> widthHeight : [[access(read)]] Size;
[[group(0), binding(1)]] var<storage> inputPixels : [[access(read)]] Image;
[[group(0), binding(2)]] var<storage> outputPixels : [[access(write)]] Image;

[[stage(compute)]]
fn main([[builtin(global_invocation_id)]] global_id : vec3<u32>) {
    let resultCell : vec2<u32> = vec2<u32>(global_id.x, global_id.y);
    let index : u32 = resultCell.y + resultCell.x * u32(widthHeight.size.y);
    if (global_id.x > 0u && global_id.y > 0u && global_id.x < u32(widthHeight.size.x) && global_id.y < u32(widthHeight.size.y)) {
    
        let w00_i : u32 = resultCell.y - 1u + (resultCell.x - 1u) * u32(widthHeight.size.y);
        let w10_i : u32 = resultCell.y - 1u + resultCell.x * u32(widthHeight.size.y);
        let w20_i : u32 = resultCell.y - 1u + (resultCell.x + 1u) * u32(widthHeight.size.y);
    
        let w01_i : u32 = resultCell.y + (resultCell.x - 1u) * u32(widthHeight.size.y);
        let w11_i : u32 = resultCell.y + resultCell.x * u32(widthHeight.size.y);
        let w21_i : u32 = resultCell.y + (resultCell.x + 1u) * u32(widthHeight.size.y);
    
        let w02_i : u32 = resultCell.y + 1u + (resultCell.x - 1u) * u32(widthHeight.size.y);
        let w12_i : u32 = resultCell.y + 1u + resultCell.x * u32(widthHeight.size.y);
        let w22_i : u32 = resultCell.y + 1u + (resultCell.x + 1u) * u32(widthHeight.size.y);
    
        let tmp : f32 = ( f32(1u * inputPixels.rgba[w00_i])   + f32(1u * inputPixels.rgba[w10_i]) + f32(1u * inputPixels.rgba[w20_i])
                        + f32(1u * inputPixels.rgba[w01_i])   + f32(1u * inputPixels.rgba[w11_i]) + f32(1u * inputPixels.rgba[w21_i])
                        + f32(1u * inputPixels.rgba[w02_i])   + f32(1u * inputPixels.rgba[w12_i]) + f32(1u * inputPixels.rgba[w22_i]) ) / f32(9);

        outputPixels.rgba[index] =  u32(tmp);
    } else {
        outputPixels.rgba[index] = inputPixels.rgba[index];
    }
}
`

const shader_copy = `
[[block]] struct Size {
    size: vec2<f32>;
};

[[block]] struct Image {
  rgba: array<u32>;
};

[[group(0), binding(0)]] var<storage> widthHeight : [[access(read)]] Size;
[[group(0), binding(1)]] var<storage> inputPixels : [[access(read)]] Image;
[[group(0), binding(2)]] var<storage> outputPixels : [[access(write)]] Image;

[[stage(compute)]]
fn main([[builtin(global_invocation_id)]] global_id : vec3<u32>) {
    let resultCell : vec2<u32> = vec2<u32>(global_id.x, global_id.y);
    let index : u32 = resultCell.y + resultCell.x * u32(widthHeight.size.y);
    outputPixels.rgba[index] = inputPixels.rgba[index];
}
`