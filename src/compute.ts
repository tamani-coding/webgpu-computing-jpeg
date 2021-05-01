import { shader_invert } from './shaders'

async function gpu() {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
        console.log('gpu adapter not available')
        return;
    }
    return await adapter.requestDevice();
}

export async function processImage(array: Uint8Array, width: number, height: number): Promise<Uint8Array> {
    const device = await gpu();

    if (!device) {
        return new Promise( (resolve, reject) => reject());
    }

    return new Promise(
        (resolve, reject) => {
            // WIDTH/HEIGHT BUFFER
            const sizeArray = new Int32Array([width, height]);
            const gpuWidthHeightBuffer = device.createBuffer({
                mappedAtCreation: true,
                size: sizeArray.byteLength,
                usage: GPUBufferUsage.STORAGE
            });
            const arrayWidthHeightBuffer = gpuWidthHeightBuffer.getMappedRange();
            new Int32Array(arrayWidthHeightBuffer).set(sizeArray);
            gpuWidthHeightBuffer.unmap();

            // INPUT BUFFER
            const gpuInputBuffer = device.createBuffer({
                mappedAtCreation: true,
                size: array.length,
                usage: GPUBufferUsage.STORAGE
            });
            const arrayBuffer = gpuInputBuffer.getMappedRange();
            new Uint8Array(arrayBuffer).set(array);
            gpuInputBuffer.unmap();

            // RESULT BUFFER
            const gpuResultBuffer = device.createBuffer({
                size: array.length,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
            });

            // BUFFER TO READ RESULT
            const gpuReadBuffer = device.createBuffer({
                size: array.length,
                usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
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
                code: shader_invert
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
                resolve(new Uint8Array(copyArrayBuffer))
            });
        }
    );
}

export function processImageCpu (array: Uint8Array, width: number, height: number): Promise<Uint8Array> {
    console.log('process image cpu');

    const result = new Uint8Array(array.length);
    return new Promise(resolve => {
        for (let i = 0; i < array.byteLength; i++) {
            const tmp = array[i]
            result[i] = 0xFF - tmp;
        }
        resolve(result);
    })
}