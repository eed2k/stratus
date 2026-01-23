#!/usr/bin/env python3
"""SSH deployment helper for Stratus"""
import paramiko
import sys
import os

# Configuration
SERVER_IP = "YOUR_SERVER_IP"
USERNAME = "root"
PASSWORD = "REDACTED_SERVER_PASSWORD"

def ssh_connect():
    """Connect to server via SSH"""
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    
    print(f"Connecting to {SERVER_IP}...")
    try:
        client.connect(SERVER_IP, username=USERNAME, password=PASSWORD, timeout=30)
        print("✓ Connected successfully!")
        return client
    except paramiko.AuthenticationException:
        print("✗ Authentication failed - check password")
        return None
    except Exception as e:
        print(f"✗ Connection failed: {e}")
        return None

def run_command(client, command, show_output=True):
    """Run a command on the server"""
    print(f"\n>>> {command}")
    stdin, stdout, stderr = client.exec_command(command, timeout=300)
    
    output = stdout.read().decode()
    errors = stderr.read().decode()
    
    if show_output and output:
        print(output)
    if errors:
        print(f"STDERR: {errors}")
    
    return stdout.channel.recv_exit_status(), output, errors

def install_ssh_key(client):
    """Install SSH public key on server"""
    ssh_key_path = os.path.expanduser("~/.ssh/id_rsa.pub")
    if os.path.exists(ssh_key_path):
        with open(ssh_key_path, 'r') as f:
            pub_key = f.read().strip()
        
        commands = [
            "mkdir -p ~/.ssh",
            "chmod 700 ~/.ssh",
            f"echo '{pub_key}' >> ~/.ssh/authorized_keys",
            "chmod 600 ~/.ssh/authorized_keys",
            "sort -u ~/.ssh/authorized_keys -o ~/.ssh/authorized_keys"  # Remove duplicates
        ]
        
        for cmd in commands:
            run_command(client, cmd, show_output=False)
        
        print("✓ SSH key installed - you can now connect without password!")
    else:
        print("No SSH key found at ~/.ssh/id_rsa.pub")

def main():
    client = ssh_connect()
    if not client:
        sys.exit(1)
    
    try:
        # Install SSH key first
        install_ssh_key(client)
        
        # Test connection
        run_command(client, "echo 'Server ready!' && uname -a")
        
    finally:
        client.close()
        print("\n✓ Done! You can now use: ssh root@YOUR_SERVER_IP")

if __name__ == "__main__":
    main()
