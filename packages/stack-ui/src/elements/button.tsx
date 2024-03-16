import React from "react";
import { useDesign } from "../providers/design-provider";
import Color from 'color';
import styled from 'styled-components';
import { BORDER_RADIUS, FONT_FAMILY, FONT_SIZES } from "../utils/constants";

function getColors(color: string, primaryBgColor: string): { 
  bgColor: string, 
  hoverBgColor: string,
  activeBgColor: string,
  textColor: string,
} {
  const c = Color(color);
  const pc = Color(primaryBgColor);
  if (c.alpha() === 0) {
    return {
      bgColor: 'transparent',
      hoverBgColor: pc.isLight() ? Color('black').alpha(0.1).toString() : Color('white').alpha(0.1).toString(),
      activeBgColor: pc.isLight() ? Color('black').alpha(0.2).toString() : Color('white').alpha(0.2).toString(),
      textColor: pc.isLight() ? 'black' : 'white',
    };
  } else if (c.isLight()) {
    return {
      bgColor: color,
      hoverBgColor: Color.hsl(c.hue(), c.saturationl(), c.lightness() - 10).toString(),
      activeBgColor: Color.hsl(c.hue(), c.saturationl(), c.lightness() - 20).toString(),
      textColor: 'black',
    };
  } else {
    return {
      bgColor: color,
      hoverBgColor: Color.hsl(c.hue(), c.saturationl(), c.lightness() + 10).toString(),
      activeBgColor: Color.hsl(c.hue(), c.saturationl(), c.lightness() + 20).toString(),
      textColor: 'white',
    };
  }
}

export type ButtonProps = {
  color?: 'primary' | 'secondary' | 'transparent' | 'warning' | string,
  size?: 'sm' | 'md' | 'lg',
  loading?: boolean,
} & Omit<React.HTMLProps<HTMLButtonElement>, 'size' | 'type'>

const StyledButton = styled.button<{
  $size: 'sm' | 'md' | 'lg',
  $bgColor: string, 
  $hoverBgColor: string,
  $activeBgColor: string,
  $textColor: string,
}>`
  border: 0;
  border-radius: ${BORDER_RADIUS};
  padding: ${props => {
    switch (props.$size) {
      case 'sm': { return '0.5rem 0.75rem'; }
      case 'md': { return '0.75rem 1rem'; }
      case 'lg': { return '1rem 2rem'; }
    }
  }};
  font-size: ${FONT_SIZES.md};
  background-color: ${props => props.$bgColor};
  color: ${props => props.$textColor};
  opacity: ${props => props.disabled ? 0.5 : 1};
  transition: background-color 0.2s;
  cursor: pointer;
  &:not([disabled]) {
    &:active,&:hover:active {
      background-color: ${props => props.$activeBgColor};
    }
    &:hover {
      background-color: ${props => props.$hoverBgColor};
    }
  }
  &:disabled {
    cursor: auto;
    opacity: 0.5;
  }
  font-family: ${FONT_FAMILY};
`;

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({
    color='primary',
    size='md',
    loading=false,
    disabled=false,
    ...props
  }, ref) => {
    const { colors } = useDesign();
    let bgColor;
    switch (color) {
      case 'primary': {
        bgColor = colors.primaryColor;
        break;
      }
      case 'secondary': {
        bgColor = colors.secondaryColor;
        break;
      }
      case 'warning': {
        bgColor = '#ff4500';
        break;
      }
      case 'transparent':
      default: {
        bgColor = color;
      }
    }
    const buttonColors = getColors(bgColor, colors.primaryBgColor);
  
    return (
      <StyledButton
        ref={ref}
        $size={size}
        $bgColor={buttonColors.bgColor}
        $hoverBgColor={buttonColors.hoverBgColor}
        $activeBgColor={buttonColors.activeBgColor}
        $textColor={buttonColors.textColor}
        disabled={disabled || loading}
        {...props}
      >
        {props.children}
      </StyledButton>
    );
  }
);

Button.displayName = 'Button';

export default Button;