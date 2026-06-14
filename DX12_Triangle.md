#ifndef UNICODE
#define UNICODE
#endif

#include <windows.h>
#include <d3d12.h>
#include <dxgi1_6.h>
#include <d3dcompiler.h>
#include <DirectXMath.h>

#pragma comment(lib, "d3d12.lib")
#pragma comment(lib, "dxgi.lib")
#pragma comment(lib, "d3dcompiler.lib")

using namespace DirectX;

// 상수 버퍼 구조체 (회전 행렬 전송용)
struct ConstantBuffer {
    XMMATRIX mWorld;
};

// 정점 구조체
struct Vertex {
    XMFLOAT3 position;
    XMFLOAT4 color;
};

// 글로벌 변수
const UINT FrameCount = 2;
HWND g_hwnd = nullptr;
ID3D12Device* g_device = nullptr;
ID3D12CommandQueue* g_commandQueue = nullptr;
IDXGISwapChain3* g_swapChain = nullptr;
ID3D12DescriptorHeap* g_rtvHeap = nullptr;
UINT g_rtvDescriptorSize = 0;
ID3D12Resource* g_renderTargets[FrameCount] = { nullptr };
ID3D12CommandAllocator* g_commandAllocator = nullptr;
ID3D12GraphicsCommandList* g_commandList = nullptr;
ID3D12RootSignature* g_rootSignature = nullptr;
ID3D12PipelineState* g_pipelineState = nullptr;
ID3D12Resource* g_vertexBuffer = nullptr;
D3D12_VERTEX_BUFFER_VIEW g_vertexBufferView{};
ID3D12Resource* g_constantBuffer = nullptr;
UINT8* g_pCbvDataBegin = nullptr;
ID3D12DescriptorHeap* g_cbvHeap = nullptr;

// 동기화 객체
UINT g_frameIndex = 0;
HANDLE g_fenceEvent = nullptr;
ID3D12Fence* g_fence = nullptr;
UINT64 g_fenceValue = 0;

float g_rotationAngle = 0.0f;

// HLSL 셰이더 소스코드 (내장)
const char* g_shaderCode =
"cbuffer ConstantBuffer : register(b0) {\n"
"    matrix g_mWorld;\n"
"};\n"
"struct VS_INPUT {\n"
"    float3 pos : POSITION;\n"
"    float4 col : COLOR;\n"
"};\n"
"struct PS_INPUT {\n"
"    float4 pos : SV_POSITION;\n"
"    float4 col : COLOR;\n"
"};\n"
"PS_INPUT VSMain(VS_INPUT input) {\n"
"    PS_INPUT output;\n"
"    output.pos = mul(g_mWorld, float4(input.pos, 1.0f));\n"
"    output.col = input.col;\n"
"    return output;\n"
"}\n"
"float4 PSMain(PS_INPUT input) : SV_TARGET {\n"
"    return input.col;\n"
"}\n";

// GPU 작업 완료 대기 함수
void WaitForPreviousFrame() {
    const UINT64 fence = g_fenceValue;
    g_commandQueue->Signal(g_fence, fence);
    g_fenceValue++;

    if (g_fence->GetCompletedValue() < fence) {
        g_fence->SetEventOnCompletion(fence, g_fenceEvent);
        WaitForSingleObject(g_fenceEvent, INFINITE);
    }
    g_frameIndex = g_swapChain->GetCurrentBackBufferIndex();
}

// 렌더링 파이프라인 및 자원 초기화
void InitDirectX12() {
    // 1. 디버그 레이어 활성화 (디버깅용)
#if defined(_DEBUG)
    ID3D12Debug* debugController;
    if (SUCCEEDED(D3D12GetDebugInterface(IID_PPV_ARGS(&debugController)))) {
        debugController->EnableDebugLayer();
        debugController->Release();
    }
#endif

    // 2. 팩토리 및 디바이스 생성
    IDXGIFactory4* factory;
    CreateDXGIFactory1(IID_PPV_ARGS(&factory));
    D3D12CreateDevice(nullptr, D3D_FEATURE_LEVEL_11_0, IID_PPV_ARGS(&g_device));

    // 3. 커맨드 큐 생성
    D3D12_COMMAND_QUEUE_DESC queueDesc = {};
    queueDesc.Flags = D3D12_COMMAND_QUEUE_FLAG_NONE;
    queueDesc.Type = D3D12_COMMAND_LIST_TYPE_DIRECT;
    g_device->CreateCommandQueue(&queueDesc, IID_PPV_ARGS(&g_commandQueue));

    // 4. 스왑 체인 생성
    DXGI_SWAP_CHAIN_DESC1 swapChainDesc = {};
    swapChainDesc.BufferCount = FrameCount;
    swapChainDesc.Width = 500;
    swapChainDesc.Height = 500;
    swapChainDesc.Format = DXGI_FORMAT_R8G8B8A8_UNORM;
    swapChainDesc.BufferUsage = DXGI_USAGE_RENDER_TARGET_OUTPUT;
    swapChainDesc.SwapEffect = DXGI_SWAP_EFFECT_FLIP_DISCARD;
    swapChainDesc.SampleDesc.Count = 1;

    IDXGISwapChain1* swapChain1;
    factory->CreateSwapChainForHwnd(g_commandQueue, g_hwnd, &swapChainDesc, nullptr, nullptr, &swapChain1);
    swapChain1->QueryInterface(IID_PPV_ARGS(&g_swapChain));
    g_frameIndex = g_swapChain->GetCurrentBackBufferIndex();
    factory->Release();

    // 5. RTV(Render Target View) 디스크립터 힙 생성
    D3D12_DESCRIPTOR_HEAP_DESC rtvHeapDesc = {};
    rtvHeapDesc.NumDescriptors = FrameCount;
    rtvHeapDesc.Type = D3D12_DESCRIPTOR_HEAP_TYPE_RTV;
    rtvHeapDesc.Flags = D3D12_DESCRIPTOR_HEAP_FLAG_NONE;
    g_device->CreateDescriptorHeap(&rtvHeapDesc, IID_PPV_ARGS(&g_rtvHeap));
    g_rtvDescriptorSize = g_device->GetDescriptorHandleIncrementSize(D3D12_DESCRIPTOR_HEAP_TYPE_RTV);

    // 6. 프레임 버퍼 자원 등록
    D3D12_CPU_DESCRIPTOR_HANDLE rtvHandle(g_rtvHeap->GetCPUDescriptorHandleForHeapStart());
    for (UINT n = 0; n < FrameCount; n++) {
        g_swapChain->GetBuffer(n, IID_PPV_ARGS(&g_renderTargets[n]));
        g_device->CreateRenderTargetView(g_renderTargets[n], nullptr, rtvHandle);
        rtvHandle.ptr += g_rtvDescriptorSize;
    }

    // 7. CBV(Constant Buffer View) 힙 생성
    D3D12_DESCRIPTOR_HEAP_DESC cbvHeapDesc = {};
    cbvHeapDesc.NumDescriptors = 1;
    cbvHeapDesc.Flags = D3D12_DESCRIPTOR_HEAP_FLAG_SHADER_VISIBLE;
    cbvHeapDesc.Type = D3D12_DESCRIPTOR_HEAP_TYPE_CBV_SRV_UAV;
    g_device->CreateDescriptorHeap(&cbvHeapDesc, IID_PPV_ARGS(&g_cbvHeap));

    g_device->CreateCommandAllocator(D3D12_COMMAND_LIST_TYPE_DIRECT, IID_PPV_ARGS(&g_commandAllocator));

    // 8. 루트 시그니처 생성 (Shader와 데이터를 연결하는 규격 정의)
    D3D12_DESCRIPTOR_RANGE cbvLayoutRange = {};
    cbvLayoutRange.RangeType = D3D12_DESCRIPTOR_RANGE_TYPE_CBV;
    cbvLayoutRange.NumDescriptors = 1;
    cbvLayoutRange.BaseShaderRegister = 0;

    D3D12_ROOT_PARAMETER rootParameter = {};
    rootParameter.ParameterType = D3D12_ROOT_PARAMETER_TYPE_DESCRIPTOR_TABLE;
    rootParameter.DescriptorTable.NumDescriptorRanges = 1;
    rootParameter.DescriptorTable.pDescriptorRanges = &cbvLayoutRange;
    rootParameter.ShaderVisibility = D3D12_SHADER_VISIBILITY_VERTEX;

    D3D12_ROOT_SIGNATURE_DESC rootSignatureDesc = {};
    rootSignatureDesc.NumParameters = 1;
    rootSignatureDesc.pParameters = &rootParameter;
    rootSignatureDesc.Flags = D3D12_ROOT_SIGNATURE_FLAG_ALLOW_INPUT_ASSEMBLER_INPUT_LAYOUT;

    ID3DBlob* signatureBlob;
    D3D12SerializeRootSignature(&rootSignatureDesc, D3D_ROOT_SIGNATURE_VERSION_1, &signatureBlob, nullptr);
    g_device->CreateRootSignature(0, signatureBlob->GetBufferPointer(), signatureBlob->GetBufferSize(), IID_PPV_ARGS(&g_rootSignature));
    signatureBlob->Release();

    // 9. 셰이더 컴파일 및 PSO 생성
    ID3DBlob* vertexShader;
    ID3DBlob* pixelShader;
    D3DCompile(g_shaderCode, strlen(g_shaderCode), nullptr, nullptr, nullptr, "VSMain", "vs_5_0", 0, 0, &vertexShader, nullptr);
    D3DCompile(g_shaderCode, strlen(g_shaderCode), nullptr, nullptr, nullptr, "PSMain", "ps_5_0", 0, 0, &pixelShader, nullptr);

    D3D12_INPUT_ELEMENT_DESC inputElementDescs[] = {
        { "POSITION", 0, DXGI_FORMAT_R32G32B32_FLOAT, 0, 0, D3D12_INPUT_CLASSIFICATION_PER_VERTEX_DATA, 0 },
        { "COLOR", 0, DXGI_FORMAT_R32G32B32A32_FLOAT, 0, 12, D3D12_INPUT_CLASSIFICATION_PER_VERTEX_DATA, 0 }
    };

    D3D12_GRAPHICS_PIPELINE_STATE_DESC psoDesc = {};
    psoDesc.InputLayout = { inputElementDescs, _countof(inputElementDescs) };
    psoDesc.pRootSignature = g_rootSignature;
    // 수정된 코드
    psoDesc.VS.pShaderBytecode = vertexShader->GetBufferPointer();
    psoDesc.VS.BytecodeLength = vertexShader->GetBufferSize();
    psoDesc.PS.pShaderBytecode = pixelShader->GetBufferPointer();
    psoDesc.PS.BytecodeLength = pixelShader->GetBufferSize();

    // 기본 레스터라이저 및 블렌드 상태 설정
    psoDesc.RasterizerState.FillMode = D3D12_FILL_MODE_SOLID;
    psoDesc.RasterizerState.CullMode = D3D12_CULL_MODE_NONE;
    psoDesc.BlendState.RenderTarget[0].BlendEnable = FALSE;
    psoDesc.BlendState.RenderTarget[0].RenderTargetWriteMask = D3D12_COLOR_WRITE_ENABLE_ALL;
    psoDesc.DepthStencilState.DepthEnable = FALSE;
    psoDesc.DepthStencilState.StencilEnable = FALSE;
    psoDesc.SampleMask = UINT_MAX;
    psoDesc.PrimitiveTopologyType = D3D12_PRIMITIVE_TOPOLOGY_TYPE_TRIANGLE;
    psoDesc.NumRenderTargets = 1;
    psoDesc.RTVFormats[0] = DXGI_FORMAT_R8G8B8A8_UNORM;
    psoDesc.SampleDesc.Count = 1;

    g_device->CreateGraphicsPipelineState(&psoDesc, IID_PPV_ARGS(&g_pipelineState));
    vertexShader->Release();
    pixelShader->Release();

    g_device->CreateCommandList(0, D3D12_COMMAND_LIST_TYPE_DIRECT, g_commandAllocator, g_pipelineState, IID_PPV_ARGS(&g_commandList));
    g_commandList->Close();

    // 10. 정점 버퍼 데이터 생성 (무지개 삼각형)
    Vertex triangleVertices[] = {
        { { 0.0f, 0.5f, 0.0f }, { 1.0f, 0.0f, 0.0f, 1.0f } },
        { { 0.5f, -0.5f, 0.0f }, { 0.0f, 1.0f, 0.0f, 1.0f } },
        { { -0.5f, -0.5f, 0.0f }, { 0.0f, 0.0f, 1.0f, 1.0f } }
    };
    const UINT vertexBufferSize = sizeof(triangleVertices);

    D3D12_HEAP_PROPERTIES heapProps = {};
    heapProps.Type = D3D12_HEAP_TYPE_UPLOAD;

    D3D12_RESOURCE_DESC resDesc = {};
    resDesc.Dimension = D3D12_RESOURCE_DIMENSION_BUFFER;
    resDesc.Width = vertexBufferSize;
    resDesc.Height = 1;
    resDesc.DepthOrArraySize = 1;
    resDesc.MipLevels = 1;
    resDesc.Format = DXGI_FORMAT_UNKNOWN;
    resDesc.SampleDesc.Count = 1;
    resDesc.Layout = D3D12_TEXTURE_LAYOUT_ROW_MAJOR;

    g_device->CreateCommittedResource(&heapProps, D3D12_HEAP_FLAG_NONE, &resDesc, D3D12_RESOURCE_STATE_GENERIC_READ, nullptr, IID_PPV_ARGS(&g_vertexBuffer));

    UINT8* pVertexDataBegin;
    g_vertexBuffer->Map(0, nullptr, reinterpret_cast<void**>(&pVertexDataBegin));
    memcpy(pVertexDataBegin, triangleVertices, sizeof(triangleVertices));
    g_vertexBuffer->Unmap(0, nullptr);

    g_vertexBufferView.BufferLocation = g_vertexBuffer->GetGPUVirtualAddress();
    g_vertexBufferView.StrideInBytes = sizeof(Vertex);
    g_vertexBufferView.SizeInBytes = vertexBufferSize;

    // 11. 상수 버퍼 생성 (회전 매트릭스용)
    UINT constantBufferSize = (sizeof(ConstantBuffer) + 255) & ~255; // 256 바이트 정렬 필요
    resDesc.Width = constantBufferSize;
    g_device->CreateCommittedResource(&heapProps, D3D12_HEAP_FLAG_NONE, &resDesc, D3D12_RESOURCE_STATE_GENERIC_READ, nullptr, IID_PPV_ARGS(&g_constantBuffer));

    D3D12_CONSTANT_BUFFER_VIEW_DESC cbvDesc = {};
    cbvDesc.BufferLocation = g_constantBuffer->GetGPUVirtualAddress();
    cbvDesc.SizeInBytes = constantBufferSize;
    g_device->CreateConstantBufferView(&cbvDesc, g_cbvHeap->GetCPUDescriptorHandleForHeapStart());

    g_constantBuffer->Map(0, nullptr, reinterpret_cast<void**>(&g_pCbvDataBegin));

    // 12. 동기화 객체 생성
    g_device->CreateFence(0, D3D12_FENCE_FLAG_NONE, IID_PPV_ARGS(&g_fence));
    g_fenceValue = 1;
    g_fenceEvent = CreateEvent(nullptr, FALSE, FALSE, nullptr);
}

// 매 프레임 그리기 및 갱신 함수
void Render() {
    // 1. 회전 행렬 업데이트
    g_rotationAngle += 0.02f;
    ConstantBuffer cb;
    cb.mWorld = XMMatrixRotationZ(g_rotationAngle);
    memcpy(g_pCbvDataBegin, &cb, sizeof(cb));

    // 2. 명령어 기록 시작
    g_commandAllocator->Reset();
    g_commandList->Reset(g_commandAllocator, g_pipelineState);

    g_commandList->SetGraphicsRootSignature(g_rootSignature);

    ID3D12DescriptorHeap* heaps[] = { g_cbvHeap };
    g_commandList->SetDescriptorHeaps(_countof(heaps), heaps);
    g_commandList->SetGraphicsRootDescriptorTable(0, g_cbvHeap->GetGPUDescriptorHandleForHeapStart());

    // 뷰포트 및 시저 렉트 설정
    D3D12_VIEWPORT viewport = { 0.0f, 0.0f, 500.0f, 500.0f, 0.0f, 1.0f };
    D3D12_RECT scissorRect = { 0, 0, 500, 500 };
    g_commandList->RSSetViewports(1, &viewport);
    g_commandList->RSSetScissorRects(1, &scissorRect);

    // 자원 상태 전환 (Present -> Render Target)
    D3D12_RESOURCE_BARRIER barrier = {};
    barrier.Type = D3D12_RESOURCE_BARRIER_TYPE_TRANSITION;
    barrier.Transition.pResource = g_renderTargets[g_frameIndex];
    barrier.Transition.StateBefore = D3D12_RESOURCE_STATE_PRESENT;
    barrier.Transition.StateAfter = D3D12_RESOURCE_STATE_RENDER_TARGET;
    g_commandList->ResourceBarrier(1, &barrier);

    D3D12_CPU_DESCRIPTOR_HANDLE rtvHandle(g_rtvHeap->GetCPUDescriptorHandleForHeapStart());
    rtvHandle.ptr += g_frameIndex * g_rtvDescriptorSize;
    g_commandList->OMSetRenderTargets(1, &rtvHandle, FALSE, nullptr);

    // 배경 지우기
    const float clearColor[] = { 0.0f, 0.0f, 0.0f, 1.0f };
    g_commandList->ClearRenderTargetView(rtvHandle, clearColor, 0, nullptr);

    // 그리기 명령어 탑재
    g_commandList->IASetPrimitiveTopology(D3D_PRIMITIVE_TOPOLOGY_TRIANGLELIST);
    g_commandList->IASetVertexBuffers(0, 1, &g_vertexBufferView);
    g_commandList->DrawInstanced(3, 1, 0, 0);

    // 자원 상태 전환 (Render Target -> Present)
    barrier.Transition.StateBefore = D3D12_RESOURCE_STATE_RENDER_TARGET;
    barrier.Transition.StateAfter = D3D12_RESOURCE_STATE_PRESENT;
    g_commandList->ResourceBarrier(1, &barrier);

    g_commandList->Close();

    // 3. 명령어 제출 및 화면 교체
    ID3D12CommandList* ppCommandLists[] = { g_commandList };
    g_commandQueue->ExecuteCommandLists(_countof(ppCommandLists), ppCommandLists);

    g_swapChain->Present(1, 0);

    WaitForPreviousFrame();
}

// 자원 해제
void CleanupDirectX12() {
    WaitForPreviousFrame();
    CloseHandle(g_fenceEvent);

    if (g_constantBuffer) { g_constantBuffer->Unmap(0, nullptr); g_constantBuffer->Release(); }
    if (g_vertexBuffer) g_vertexBuffer->Release();
    if (g_cbvHeap) g_cbvHeap->Release();
    if (g_pipelineState) g_pipelineState->Release();
    if (g_rootSignature) g_rootSignature->Release();
    if (g_commandList) g_commandList->Release();
    if (g_commandAllocator) g_commandAllocator->Release();
    for (UINT n = 0; n < FrameCount; n++) {
        if (g_renderTargets[n]) g_renderTargets[n]->Release();
    }
    if (g_rtvHeap) g_rtvHeap->Release();
    if (g_swapChain) g_swapChain->Release();
    if (g_commandQueue) g_commandQueue->Release();
    if (g_fence) g_fence->Release();
    if (g_device) g_device->Release();
}

// 윈도우 메시지 처리
LRESULT CALLBACK WndProc(HWND hWnd, UINT message, WPARAM wParam, LPARAM lParam) {
    if (message == WM_DESTROY) {
        PostQuitMessage(0);
        return 0;
    }
    return DefWindowProc(hWnd, message, wParam, lParam);
}

// 진입점
int main() {
    HINSTANCE hInstance = GetModuleHandle(0);
    WNDCLASSW wc = { 0, WndProc, 0, 0, hInstance, 0, 0, 0, 0, L"DX12" };
    RegisterClassW(&wc);

    g_hwnd = CreateWindowW(L"DX12", L"Rotating Triangle (DirectX 12)", WS_VISIBLE | WS_OVERLAPPEDWINDOW, 100, 100, 500, 500, 0, 0, hInstance, 0);

    InitDirectX12();

    MSG msg = {};
    while (msg.message != WM_QUIT) {
        if (PeekMessage(&msg, nullptr, 0, 0, PM_REMOVE)) {
            TranslateMessage(&msg);
            DispatchMessage(&msg);
        }
        else {
            Render();
        }
    }

    CleanupDirectX12();
    return 0;
}
