terraform {
  required_providers { aws = { source = "hashicorp/aws" } }
}

# The API: a Lambda behind API Gateway.
resource "aws_apigatewayv2_api" "http" {
  name          = "orders-api"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_integration" "orders" {
  api_id           = aws_apigatewayv2_api.http.id
  integration_type = "AWS_PROXY"
  integration_uri  = aws_lambda_function.orders.invoke_arn
}

resource "aws_lambda_function" "orders" {
  function_name = "orders-handler"
  role          = aws_iam_role.lambda.arn
  environment {
    variables = {
      TABLE = aws_dynamodb_table.orders.name
      QUEUE = aws_sqs_queue.events.url
      NOTE  = "braces in strings { are ignored }"
    }
  }
}

resource "aws_iam_role" "lambda" {
  name               = "orders-lambda"
  assume_role_policy = <<EOF
{ "Version": "2012-10-17", "Statement": [ { "Effect": "Allow" } ] }
EOF
}
