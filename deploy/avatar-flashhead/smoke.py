"""Validate installed single-GPU source imports before downloading 7.6 GiB."""
import argparse
import json
import os
import sys
from pathlib import Path

from assets import prepare_source


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--require-cuda', action='store_true')
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    manifest = json.loads((root/'manifest.json').read_text(encoding='utf-8'))
    print('Checking pinned source and loading PyTorch...', flush=True)
    upstream = prepare_source(root, manifest)
    sys.path.insert(0, str(upstream))
    original_cwd = Path.cwd()
    try:
        os.chdir(upstream)
        import torch

        if args.require_cuda:
            if not torch.cuda.is_available():
                raise RuntimeError('CUDA unavailable in the new runtime; model download cancelled.')
            free, _ = torch.cuda.mem_get_info()
            if free < 14 * 1024**3:
                raise RuntimeError(f'Experiment needs 14 GiB free VRAM; found {free/1024**3:.1f}. '
                                   'No existing GPU process was stopped.')
            if not torch.cuda.is_bf16_supported(including_emulation=False):
                raise RuntimeError('Native BF16 is required for this experiment.')
            with torch.no_grad():
                q = torch.randn(1, 2, 32, 64, device='cuda', dtype=torch.bfloat16)
                attended = torch.nn.functional.scaled_dot_product_attention(q, q, q)
                pixels = torch.randn(1, 3, 16, 16, device='cuda', dtype=torch.bfloat16)
                kernel = torch.randn(4, 3, 3, 3, device='cuda', dtype=torch.bfloat16)
                convolved = torch.nn.functional.conv2d(pixels, kernel)
                assert torch.isfinite(attended).all() and torch.isfinite(convolved).all()
                torch.cuda.synchronize()
            print(f'CUDA preflight passed: {torch.cuda.get_device_name()}, '
                  f'free={free/1024**3:.1f} GiB, torch={torch.__version__}.', flush=True)
            del q, attended, pixels, kernel, convolved
            torch.cuda.empty_cache()
        print('Importing the actual FlashHead inference modules...', flush=True)
        from flash_head.audio_analysis.wav2vec2 import Wav2Vec2Model
        from flash_head.inference import get_infer_params
        from flash_head.ltx_video.models.autoencoders.causal_video_autoencoder import (
            CausalVideoAutoencoder,
        )
        from flash_head.src.modules.flash_head_model import flash_attention
        from transformers import Wav2Vec2Config

        assert CausalVideoAutoencoder is not None
        assert get_infer_params()['frame_num'] == 33
        # This process is only a tiny compatibility check, not the GPU benchmark.
        torch.set_num_threads(2)
        torch.manual_seed(1)
        q, k, v = [torch.randn(1, 5, 16) for _ in range(3)]
        actual = flash_attention(q, k, v, num_heads=2)
        expected = torch.nn.functional.scaled_dot_product_attention(
            q.reshape(1, 5, 2, 8).transpose(1, 2),
            k.reshape(1, 5, 2, 8).transpose(1, 2),
            v.reshape(1, 5, 2, 8).transpose(1, 2),
        ).transpose(1, 2).reshape(1, 5, 16)
        torch.testing.assert_close(actual, expected)
        print('SDPA passed; checking the audio encoder with tiny random weights...', flush=True)
        config = Wav2Vec2Config(hidden_size=32, num_hidden_layers=1,
                               num_attention_heads=2, intermediate_size=64,
                               conv_dim=(8, 8, 8), conv_stride=(5, 2, 2),
                               conv_kernel=(10, 3, 3), num_conv_pos_embedding_groups=2)
        encoder = Wav2Vec2Model(config).eval()
        with torch.no_grad():
            output = encoder(torch.zeros(1, 16000), seq_len=25, output_hidden_states=True)
        assert output.last_hidden_state.shape == (1, 25, 32)
        assert torch.isfinite(output.last_hidden_state).all()
        print('PASS: source imports, SDPA attention, tiny audio encoder forward (CPU).')
        print('This does not test pretrained weights, CUDA speed, or image quality.')
    finally:
        os.chdir(original_cwd)


if __name__ == '__main__':
    main()
