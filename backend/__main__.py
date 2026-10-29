"""Run the API with explicit local .env loading: python -m backend."""
import argparse
import os

from .config import DEFAULT_ENV, load_environment


def main():
    parser = argparse.ArgumentParser(description='Run the Oculog API with local configuration.')
    parser.add_argument('--env-file', default=str(DEFAULT_ENV))
    parser.add_argument('--no-env-file', action='store_true')
    parser.add_argument('--host')
    parser.add_argument('--port', type=int)
    parser.add_argument('--reload', action='store_true')
    args = parser.parse_args()
    if not args.no_env_file:
        load_environment(args.env_file)
    import uvicorn
    uvicorn.run('backend.main:app', host=args.host or os.environ.get('OCULOG_HOST', '127.0.0.1'),
                port=args.port if args.port is not None else int(os.environ.get('OCULOG_PORT', '8000')), reload=args.reload)


if __name__ == '__main__':
    main()
