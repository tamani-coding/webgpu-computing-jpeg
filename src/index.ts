import { decode, encode, RawImageData, BufferLike } from 'jpeg-js'
import * as buffer from 'buffer';
(window as any).Buffer = buffer.Buffer;

document.getElementById('fileinput').onchange = imageSelected;

function imageSelected (event: Event) {
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
        const d = decode(arrayReader.result as ArrayBuffer);
        processImage(new Uint8Array(d.data), d.width, d.height). then(result => {
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

            // ASSIGN DATA URL TO OUTPUT IMAGE ELEMENT
            (document.getElementById('outputimage') as HTMLImageElement).src = processed
        });
    })
    arrayReader.readAsArrayBuffer(files[0]);
}

async function processImage (array: Uint8Array, width: number, height: number) : Promise<Uint8Array> {
    const adapter = await navigator.gpu.requestAdapter();
    const device = await adapter.requestDevice();

    return new Promise(resolve => {
        // INIT BUFFERS
        const sizeArray= new Int32Array([width, height]);
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
            usage: GPUBufferUsage.STORAGE
        });
        new Uint8Array(gpuInputBuffer.getMappedRange()).set(array);
        gpuInputBuffer.unmap();

        const gpuResultBuffer = device.createBuffer({
            size: array.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
        });

        const gpuReadBuffer = device.createBuffer({
            size: array.byteLength,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
        });

        // BINDING GROUP LAYOUT
        const bindGroupLayout = device.createBindGroupLayout({
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer : {
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
                    let r = (rgba >> 24) & 0xFF;
                    let g = (rgba >> 16) & 0xFF;
                    let b = (rgba >> 8) & 0xFF;
                    let a = rgba & 0xFF;
                    return vec4(r, g, b, a);
                }

                fn decompose_rgb(_rgba: u32) -> vec3<u32> {
                    let rgba = decompose_rgba(_rgba);
                    return vec3<u32>(rgba.x, rgba.y, rgba.z);
                }
                
                fn compose_rgba(r: u32, g: u32, b: u32, a: u32) -> u32 {
                    return (r << 24) + (g << 16) + (b << 8) + a;
                }

                fn grayscale_avg(_rgba: u32) -> u32 {
                    let rgba = decompose_rgba(_rgba);
                    let gray = dot(vec3<u32>(rgba.x, rgba.y, rgba.z), vec3<u32>(1)) / 3;
                    return compose_rgba(gray, gray, gray, gray);
                }

                fn grayscale_luma(_rgba: u32) -> u32 {
                    let rgba = decompose_rgba(_rgba);
                    let gray = (u32(f32(rgba.x) * 0.3) + u32(f32(rgba.y) * 0.59) + u32(f32(rgba.z) * 0.11));
                    return compose_rgba(gray, gray, gray, gray);
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

                @compute
                @workgroup_size(1)
                fn main (@builtin(global_invocation_id) global_id: vec3<u32>) {
                    let index : u32 = global_id.x + global_id.y * widthHeight.size.x;
                    // outputPixels.rgba[index] = grayscale_luma(inputPixels.rgba[index]);
                    outputPixels.rgba[index] = gaussian_blur(global_id);
                }
            `
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

        // START COMPUTE PASS
        const commandEncoder = device.createCommandEncoder();
        const passEncoder = commandEncoder.beginComputePass();
        passEncoder.setPipeline(computePipeline);
        passEncoder.setBindGroup(0, bindGroup);
        passEncoder.dispatchWorkgroups(width, height);
        passEncoder.end();

        commandEncoder.copyBufferToBuffer(gpuResultBuffer, 0, gpuReadBuffer, 0, array.byteLength);

        device.queue.submit([commandEncoder.finish()]);

        gpuReadBuffer.mapAsync(GPUMapMode.READ).then( () => {
            resolve(new Uint8Array(gpuReadBuffer.getMappedRange()));
        });
    });
}