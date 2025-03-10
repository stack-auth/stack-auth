from setuptools import setup, find_packages

setup(
    name="stack-auth-cli",
    version="0.1.0",
    description="CLI client for Stack Auth",
    author="Stack Auth Team",
    packages=find_packages(),
    py_modules=["stack_auth_cli"],
    install_requires=[
        "requests>=2.25.0",
    ],
    entry_points={
        "console_scripts": [
            "stack-auth=stack_auth_cli:main",
        ],
    },
    classifiers=[
        "Development Status :: 3 - Alpha",
        "Intended Audience :: Developers",
        "License :: OSI Approved :: MIT License",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.6",
        "Programming Language :: Python :: 3.7",
        "Programming Language :: Python :: 3.8",
        "Programming Language :: Python :: 3.9",
    ],
)
