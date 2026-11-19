#!/usr/bin/env bash
set -euo pipefail
if [ "$#" -lt 2 ] || [ "$#" -gt 3 ]; then
  echo 'Usage: bash deploy/ec2/deploy.sh <vpc-id> <public-subnet-id> [base-domain]' >&2
  exit 1
fi
cd -- "$(dirname -- "$0")/../.."
if [ -n "$(git status --porcelain)" ]; then
  echo 'Commit and push the reviewed changes before deployment.' >&2
  exit 1
fi
revision=$(git rev-parse HEAD)
aws sts get-caller-identity --profile date2gether --region us-east-2 --query Account --output text >/dev/null
aws cloudformation deploy \
  --profile date2gether --region us-east-2 \
  --stack-name date2gether-demo \
  --template-file deploy/ec2/cloudformation.json \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides "VpcId=$1" "SubnetId=$2" "BaseDomain=${3:-}" "GitRef=$revision" ParticipantLimit=6 \
  --tags Project=date2gether Purpose=academic-demo
aws cloudformation describe-stacks \
  --profile date2gether --region us-east-2 --stack-name date2gether-demo \
  --query 'Stacks[0].Outputs' --output table
