import { decode, encode, RawImageData, BufferLike } from 'jpeg-js'
import * as buffer from 'buffer';
(window as any).Buffer = buffer.Buffer;

document.getElementById('fileinput').onchange = imageSelected;

function imageSelected(event: Event) {
    const files = this.files;

    if (!files || files.length < 1) {
        return;
    }
    if (files[0].type != 'image/jpeg') {
        console.log('file is not a jpeg!');
        return;
    }

    const dataUrlReader = new FileReader();
    dataUrlReader.addEventListener('load', function () {
        (document.getElementById('inputimage') as HTMLImageElement).src = dataUrlReader.result as string;
    });
    dataUrlReader.readAsDataURL(files[0]);

    const arrayReader = new FileReader();
    arrayReader.addEventListener('load', function () {
        const d = decode(arrayReader.result as ArrayBuffer, { formatAsRGBA: true, useTArray: true });
        const output_div = document.getElementById('outputimages');
        processImage(new Uint8Array(d.data), d.width, d.height).then(result => {
            // ENCODE TO JPEG DATA
            const resultImage: RawImageData<BufferLike> = {
                width: d.width,
                height: d.height,
                data: result
            }
            const encoded = encode(resultImage, 100)

            // AS DATA URL
            let binary = '';
            var bytes = new Uint8Array(encoded.data);
            var len = bytes.byteLength;
            for (var i = 0; i < len; i++) {
                binary += String.fromCharCode(bytes[i]);
            }
            let processed = 'data:' + files[0].type + ';base64,'
            processed += window.btoa(binary);
            const img = new Image(d.width, d.height);
            img.src = processed;
            output_div.appendChild(img);
        });
    });
    arrayReader.readAsArrayBuffer(files[0]);
}

async function processImage(array: Uint8Array, width: number, height: number): Promise<Uint8Array> {
    console.log("processImage...");
    const adapter = await navigator.gpu.requestAdapter({
        powerPreference: "high-performance",
    });
    const device = await adapter.requestDevice();

    return new Promise(async resolve => {
        // INIT BUFFERS
        const sizeArray = new Int32Array([width, height]);
        const gpuWidthHeightBuffer = device.createBuffer({
            mappedAtCreation: true,
            size: sizeArray.byteLength,
            usage: GPUBufferUsage.STORAGE
        });
        new Int32Array(gpuWidthHeightBuffer.getMappedRange()).set(sizeArray);
        gpuWidthHeightBuffer.unmap();

        const gpuInputBuffer = device.createBuffer({
            mappedAtCreation: true,
            size: array.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
        });
        new Uint8Array(gpuInputBuffer.getMappedRange()).set(array);
        gpuInputBuffer.unmap();

        const gpuResultBuffer = device.createBuffer({
            size: array.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
        });

        const gpuReadBuffer = device.createBuffer({
            size: array.byteLength,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
        });

        // BINDING GROUP LAYOUT
        const bindGroupLayout1 = device.createBindGroupLayout({
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

        const bindGroup1 = device.createBindGroup({
            layout: bindGroupLayout1,
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

        const bindGroupLayout2 = device.createBindGroupLayout({
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

        const bindGroup2 = device.createBindGroup({
            layout: bindGroupLayout2,
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
                        buffer: gpuResultBuffer
                    }
                },
                {
                    binding: 2,
                    resource: {
                        buffer: gpuInputBuffer
                    }
                }
            ]
        });

        // SHADER
        const shaderModule = device.createShaderModule({
            code: /* wgsl */`
                struct Size {
                    size: vec2<u32>
                };

                struct Image {
                    rgba: array<u32>
                };

                @group(0) @binding(0) var<storage,read> widthHeight: Size;
                @group(0) @binding(1) var<storage,read_write> inputPixels: Image;
                @group(0) @binding(2) var<storage,read_write> outputPixels: Image;

                fn invert(rgba: u32) -> u32 {
                    return 4294967295u - rgba;
                }

                fn decompose_rgba(rgba: u32) -> vec4<u32> {
                    let a = (rgba >> 24) & 0xFF;
                    let b = (rgba >> 16) & 0xFF;
                    let g = (rgba >> 8) & 0xFF;
                    let r = rgba & 0xFF;
                    return vec4(r, g, b, a);
                }

                fn decompose_rgb(_rgba: u32) -> vec3<u32> {
                    let rgba = decompose_rgba(_rgba);
                    return vec3<u32>(rgba.x, rgba.y, rgba.z);
                }
                
                fn compose_rgba(r: u32, g: u32, b: u32, a: u32) -> u32 {
                    return (a << 24) + (b << 16) + (g << 8) + r;
                }

                fn grayscale_avg(_rgba: u32) -> u32 {
                    let rgba = decompose_rgba(_rgba);
                    let gray = dot(vec3<u32>(rgba.x, rgba.y, rgba.z), vec3<u32>(1)) / 3;
                    return compose_rgba(gray, gray, gray, gray);
                }

                fn grayscale_luma(_rgba: u32) -> u32 {
                    let rgba = decompose_rgba(_rgba);
                    let gray = (u32(f32(rgba.x) * 0.3) + u32(f32(rgba.y) * 0.59) + u32(f32(rgba.z) * 0.11));
                    return compose_rgba(gray, gray, gray, 255);
                }

                fn gaussian_blur(global_id: vec3<u32>) -> u32 {
                    let kernel = array<vec3<f32>, 3>(
                        vec3(1f/16f, 1f/8f, 1f/16f),
                        vec3(1f/8f, 1f/4f, 1f/8f),
                        vec3(1f/16f, 1f/8f, 1f/16f),
                    );

                    let rgba = inputPixels.rgba[global_id.x + global_id.y * widthHeight.size.x];

                    let center = rgba;
                    
                    var top = 0u;
                    if global_id.y != 0 {
                        top = inputPixels.rgba[global_id.x + (global_id.y - 1) * widthHeight.size.x];
                    }

                    var top_left = 0u;
                    if !(global_id.x == 0 || global_id.y == 0) {
                        top_left = inputPixels.rgba[(global_id.x - 1) + (global_id.y - 1) * widthHeight.size.x];
                    }

                    var top_right = 0u;
                    if !(global_id.x == widthHeight.size.x - 1 || global_id.y == 0) {
                        top_right = inputPixels.rgba[(global_id.x + 1) + (global_id.y - 1) * widthHeight.size.x];
                    }

                    var bottom = 0u;
                    if global_id.y != widthHeight.size.y - 1 {
                        bottom = inputPixels.rgba[global_id.x + (global_id.y + 1) * widthHeight.size.x];
                    }

                    var bottom_left = 0u;
                    if !(global_id.x == 0 || global_id.y == widthHeight.size.y - 1) {
                        bottom_left = inputPixels.rgba[(global_id.x - 1) + (global_id.y + 1) * widthHeight.size.x];
                    }

                    var bottom_right = 0u;
                    if !(global_id.x == widthHeight.size.x - 1 || global_id.y == widthHeight.size.y - 1) {
                        bottom_right = inputPixels.rgba[(global_id.x + 1) + (global_id.y + 1) * widthHeight.size.x];
                    }

                    var left = 0u;
                    if global_id.x != 0 {
                        left = inputPixels.rgba[(global_id.x - 1) + global_id.y * widthHeight.size.x];
                    }

                    var right = 0u;
                    if global_id.x != widthHeight.size.x - 1 {
                        right = inputPixels.rgba[(global_id.x + 1) + global_id.y * widthHeight.size.x];
                    }
                    
                    let window = array<vec3<u32>, 3>(
                        vec3(top_left, top, top_right),
                        vec3(left, center, right),
                        vec3(bottom_left, bottom, bottom_right),
                    );

                    var blurred_pixel = vec3<f32>(0.0);

                    for ( var i: u32 = 0; i < 3; i++ ) {
                        blurred_pixel += kernel[i].x * vec3<f32>(decompose_rgb(window[i].x));
                        blurred_pixel += kernel[i].y * vec3<f32>(decompose_rgb(window[i].y));
                        blurred_pixel += kernel[i].z * vec3<f32>(decompose_rgb(window[i].z));
                    }

                    return compose_rgba(u32(blurred_pixel.x), u32(blurred_pixel.y), u32(blurred_pixel.z), decompose_rgba(rgba).w);
                    // return compose_rgba(decompose_rgba(rgba).x, decompose_rgba(rgba).y, decompose_rgba(rgba).z, decompose_rgba(rgba).w);
                }

                fn get_rgb_at_pixel(x: u32, y: u32) -> vec3<u32> {
                    return decompose_rgb(inputPixels.rgba[x + y * widthHeight.size.x]);
                }

                fn gaussian_blur_7(global_id: vec3<u32>) -> u32 {
                    if global_id.x <= 2 || global_id.y <= 2 || global_id.x >= widthHeight.size.x - 2 || global_id.y >= widthHeight.size.y - 2 {
                        return inputPixels.rgba[global_id.x + global_id.y * widthHeight.size.x];
                    } else {
                        var kernel = array<f32, 49>(
                            0, 0, 1, 2, 1, 0, 0,
                            0, 3, 13, 22, 13, 3, 0,
                            1, 13, 59, 97, 59, 12, 1,
                            2, 22, 97, 159, 97, 22, 2,
                            1, 13, 59, 97, 59, 12, 1,
                            0, 3, 13, 22, 13, 3, 0,
                            0, 0, 1, 2, 1, 0, 0,
                        );

                        for (var i: u32 = 0; i < 49; i++ ) {
                            kernel[i] = kernel[i] / 1003f;
                        }

                        var blurred_pixel = vec3<f32>(0.0);

                        for ( var row: u32 = 0; row < 7; row++ ) {
                            for ( var col: u32 = 0; col < 7; col++ ) {
                                let x = global_id.x + col - 3;
                                let y = global_id.y + row - 3;
                                blurred_pixel += kernel[row * 7 + col] * vec3<f32>(get_rgb_at_pixel(x, y));
                            }
                        }
                        let a = decompose_rgba(inputPixels.rgba[global_id.x + global_id.y * widthHeight.size.x]).w;
                        return compose_rgba(u32(blurred_pixel.x), u32(blurred_pixel.y), u32(blurred_pixel.z), 255);
                    }
                }

                @compute
                @workgroup_size(16, 16)
                fn main (@builtin(global_invocation_id) global_id: vec3<u32>) {
                    if (global_id.x >= widthHeight.size.x || global_id.y >= widthHeight.size.y) {
                        return;
                    }

                    let index : u32 = global_id.x + global_id.y * widthHeight.size.x;
                    // outputPixels.rgba[index] = grayscale_luma(inputPixels.rgba[index]);
                    outputPixels.rgba[index] = gaussian_blur_7(global_id);
                }
            `
        });

        const commandEncoder = device.createCommandEncoder();
        for (let i = 0; i < 20; i++) {
            let passEncoder = commandEncoder.beginComputePass();
            const bindGroupIndex = i % 2;
            const computePipeline = device.createComputePipeline({
                layout: device.createPipelineLayout({
                    bindGroupLayouts: bindGroupIndex == 0 ? [bindGroupLayout1, bindGroupLayout2] : [bindGroupLayout2, bindGroupLayout1]
                }),
                compute: {
                    module: shaderModule,
                    entryPoint: "main"
                }
            });
            passEncoder.setPipeline(computePipeline);
            passEncoder.setBindGroup(0, bindGroupIndex == 0 ? bindGroup1 : bindGroup2);
            passEncoder.setBindGroup(1, bindGroupIndex == 0 ? bindGroup2 : bindGroup1);
            passEncoder.dispatchWorkgroups(width, height);
            passEncoder.end();
            // commandEncoder.copyBufferToBuffer(gpuResultBuffer, 0, gpuInputBuffer, 0, array.byteLength);
        }
        commandEncoder.copyBufferToBuffer(gpuResultBuffer, 0, gpuReadBuffer, 0, array.byteLength);
        device.queue.submit([commandEncoder.finish()]);
        await gpuReadBuffer.mapAsync(GPUMapMode.READ);
        resolve(new Uint8Array(gpuReadBuffer.getMappedRange()));
    });
}
